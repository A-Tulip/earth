/**
 * CachedFetcher —— 前端 API 通用缓存/去重/节流工具
 *
 * 解决 issue #18：测量/数据图层使用 Nominatim/Open-Meteo/USGS 等免费 API
 * 时触发 HTTP 429 (Too Many Requests) / 400 (Bad Request)。
 *
 * 特性：
 * 1. TTL 内存缓存 —— 相同 URL 在有效期内直接返回缓存结果
 * 2. Promise 去重（dedupe）—— 相同 URL 的并发请求共享同一个 Promise
 * 3. 请求节流 —— 单域名并发请求数受限，避免瞬间爆发流量
 * 4. 429/400 静默期 —— 限流/错误后一段时间内不再请求同一 URL
 * 5. localStorage 持久化缓存（可选）—— 刷新页面后缓存仍在
 *
 * TTL 推荐：
 *   - 天气预报：10 分钟（天气实时性要求较高）
 *   - 地震/自然事件：1 小时（USGS 更新频率 ~每 5~15 分钟）
 *   - 气温/降水年数据：24 小时（历史数据不变）
 *   - 地理编码结果：7 天（城市/地点坐标基本不变）
 */

/** 缓存条目 */
interface CacheEntry<T> {
  value: T;
  expireAt: number; // Unix ms，超过此时间视为过期
}

/** 静默期条目（429/错误后一段时间内不再请求） */
interface CooldownEntry {
  expireAt: number; // Unix ms
  reason: string; // 429 / 400 / network
}

/** CachedFetcher 配置 */
export interface FetcherConfig {
  /** TTL 缓存有效时长（毫秒），默认 10 分钟 */
  ttlMs?: number;
  /** 错误/限流后静默时长（毫秒），默认 60 秒 */
  cooldownMs?: number;
  /** 单域名最大并发数，默认 3 */
  maxConcurrencyPerOrigin?: number;
  /** 请求间最小间隔（毫秒），默认 100ms */
  minRequestIntervalMs?: number;
  /** 是否使用 localStorage 持久化缓存，默认 false（数据量大时关闭节省空间） */
  persist?: boolean;
  /** localStorage key 前缀，避免跨项目冲突 */
  persistKeyPrefix?: string;
}

const DEFAULT_CONFIG: Required<Omit<FetcherConfig, 'persistKeyPrefix'>> & { persistKeyPrefix: string } = {
  ttlMs: 10 * 60 * 1000,
  cooldownMs: 60 * 1000,
  maxConcurrencyPerOrigin: 3,
  minRequestIntervalMs: 100,
  persist: false,
  persistKeyPrefix: 'cf:',
};

/** 从 URL 提取 origin（协议+域名+端口） */
function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** 并发 + 间隔节流队列 */
class ThrottleQueue {
  private pendingPerOrigin = new Map<string, number>();
  private lastRequestAtPerOrigin = new Map<string, number>();
  private maxConcurrency: number;
  private minIntervalMs: number;

  constructor(maxConcurrency: number, minIntervalMs: number) {
    this.maxConcurrency = maxConcurrency;
    this.minIntervalMs = minIntervalMs;
  }

  /** 执行任务，受并发和间隔限制 */
  async run<T>(origin: string, task: () => Promise<T>): Promise<T> {
    // 等待满足条件：并发 < maxConcurrency 且 距上次请求 ≥ minIntervalMs
    while (true) {
      const running = this.pendingPerOrigin.get(origin) ?? 0;
      const last = this.lastRequestAtPerOrigin.get(origin) ?? 0;
      const now = Date.now();
      if (running < this.maxConcurrency && now - last >= this.minIntervalMs) {
        this.pendingPerOrigin.set(origin, running + 1);
        this.lastRequestAtPerOrigin.set(origin, now);
        try {
          return await task();
        } finally {
          const r = this.pendingPerOrigin.get(origin) ?? 1;
          this.pendingPerOrigin.set(origin, Math.max(0, r - 1));
        }
      }
      // 不满足条件，等待一段时间再检查
      const waitMs = Math.min(
        100,
        Math.max(
          10,
          this.minIntervalMs - (now - last),
          running >= this.maxConcurrency ? 50 : 0,
        ),
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export class CachedFetcher {
  private config: Required<Omit<FetcherConfig, 'persistKeyPrefix'>> & { persistKeyPrefix: string };
  private memoryCache = new Map<string, CacheEntry<unknown>>();
  private cooldown = new Map<string, CooldownEntry>();
  private inFlight = new Map<string, Promise<unknown>>(); // 并发去重
  private queue: ThrottleQueue;

  constructor(config: FetcherConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.queue = new ThrottleQueue(
      this.config.maxConcurrencyPerOrigin,
      this.config.minRequestIntervalMs,
    );
    if (this.config.persist) {
      this.restoreFromLocalStorage();
    }
  }

  /**
   * 发起请求：自动应用缓存/去重/节流/静默期
   *
   * @param url 请求 URL
   * @param options.fetchOptions fetch options（body/method 等）
   * @param options.customTtlMs 覆盖默认 TTL
   * @param options.customKey 自定义缓存 key（默认使用 URL）
   * @param options.parser 响应解析函数，默认 response.json()
   */
  async fetch<T>(
    url: string,
    options: {
      fetchOptions?: RequestInit;
      customTtlMs?: number;
      customKey?: string;
      parser?: (res: Response) => Promise<T>;
    } = {},
  ): Promise<T> {
    const key = options.customKey ?? url;
    const parser = options.parser ?? ((res: Response) => res.json() as Promise<T>);
    const ttlMs = options.customTtlMs ?? this.config.ttlMs;

    // 1. 先查内存缓存
    const cached = this.memoryCache.get(key);
    if (cached && cached.expireAt > Date.now()) {
      return cached.value as T;
    }

    // 2. 并发去重：若同 key 已有进行中的请求，共享结果
    const inflight = this.inFlight.get(key);
    if (inflight) {
      return inflight as Promise<T>;
    }

    // 3. 检查静默期（前一次 429/错误冷却中）
    const cool = this.cooldown.get(url);
    if (cool && cool.expireAt > Date.now()) {
      const remain = Math.round((cool.expireAt - Date.now()) / 1000);
      throw new Error(`Rate limited / error cooldown: ${cool.reason} (remaining ${remain}s)`);
    }

    // 4. 发起请求，应用节流队列
    const origin = getOrigin(url);
    const promise = (async () => {
      try {
        const value: T = await this.queue.run(origin, async () => {
          const res = await fetch(url, options.fetchOptions);
          // 429 / 4xx / 5xx → 进入静默期
          if (res.status === 429) {
            this.cooldown.set(url, {
              expireAt: Date.now() + this.config.cooldownMs,
              reason: 'HTTP 429 Too Many Requests',
            });
            throw new Error('HTTP 429 Too Many Requests');
          }
          if (res.status === 400) {
            this.cooldown.set(url, {
              expireAt: Date.now() + Math.max(30_000, this.config.cooldownMs / 2),
              reason: 'HTTP 400 Bad Request',
            });
          }
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return await parser(res);
        });

        // 成功 → 写入缓存
        this.memoryCache.set(key, { value, expireAt: Date.now() + ttlMs });
        if (this.config.persist) {
          this.persistOne(key, { value, expireAt: Date.now() + ttlMs });
        }
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /** 手动清除某个 key 的缓存 */
  invalidate(key: string): void {
    this.memoryCache.delete(key);
    if (this.config.persist) {
      try {
        localStorage.removeItem(this.config.persistKeyPrefix + key);
      } catch (e) { console.warn('[EmptyCatch] state/CachedFetcher.ts:216', e instanceof Error ? e.message : String(e)); }
    }
  }

  /** 清除所有缓存（但不清除静默期） */
  clear(): void {
    this.memoryCache.clear();
    if (this.config.persist) {
      const prefix = this.config.persistKeyPrefix;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          localStorage.removeItem(k);
        }
      }
    }
  }

  /** 清除所有静默期（一般不用，调试用） */
  clearCooldown(): void {
    this.cooldown.clear();
  }

  // ============ localStorage 持久化（辅助方法） ============

  private restoreFromLocalStorage(): void {
    try {
      const prefix = this.config.persistKeyPrefix;
      const now = Date.now();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as CacheEntry<unknown>;
          if (parsed.expireAt > now) {
            this.memoryCache.set(k.slice(prefix.length), parsed);
          } else {
            localStorage.removeItem(k);
          }
        } catch {
          localStorage.removeItem(k);
        }
      }
    } catch {
      // localStorage 访问失败（隐私模式等），关闭持久化避免重复失败
      this.config.persist = false;
    }
  }

  private persistOne(key: string, entry: CacheEntry<unknown>): void {
    try {
      localStorage.setItem(
        this.config.persistKeyPrefix + key,
        JSON.stringify(entry),
      );
    } catch {
      // 容量不足 / 禁用 localStorage → 忽略
    }
  }
}

// ============ 限流 / 错误事件通知（UI 层用） ============
/** 限流事件类型 */
export interface RateLimitEvent {
  /** 受限的 URL（或域名） */
  url: string;
  /** 原因：429 / 400 / network 等 */
  reason: string;
  /** 静默期剩余秒数（近似） */
  remainSeconds: number;
  /** 发生时间 */
  at: Date;
}

type RateLimitListener = (ev: RateLimitEvent) => void;

/** 全局限流事件监听器 */
const rateLimitListeners: Set<RateLimitListener> = new Set();
export function onRateLimit(listener: RateLimitListener): () => void {
  rateLimitListeners.add(listener);
  return () => rateLimitListeners.delete(listener);
}
function emitRateLimit(url: string, reason: string, remainSeconds: number) {
  if (rateLimitListeners.size === 0) return;
  const ev: RateLimitEvent = { url, reason, remainSeconds, at: new Date() };
  rateLimitListeners.forEach((l) => {
    try {
      l(ev);
    } catch {
      // ignore listener error
    }
  });
}

/** 修改 CachedFetcher：在静默期触发和 HTTP 429 时 emit event */
// （通过 patch 原始 prototype，避免类内部膨胀）
const origFetch = CachedFetcher.prototype.fetch as (
  url: string,
  options?: {
    fetchOptions?: RequestInit;
    customTtlMs?: number;
    customKey?: string;
    parser?: (res: Response) => Promise<unknown>;
  },
) => Promise<unknown>;
CachedFetcher.prototype.fetch = async function <T>(
  url: string,
  options: {
    fetchOptions?: RequestInit;
    customTtlMs?: number;
    customKey?: string;
    parser?: (res: Response) => Promise<T>;
  } = {},
): Promise<T> {
  try {
    return (await origFetch.call(this, url, options)) as T;
  } catch (e) {
    // 检测是否是 cooldown 错误
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Rate limited') || msg.includes('cooldown') || msg.includes('429') || msg.includes('400')) {
      const remainMatch = msg.match(/remaining (\d+)s/);
      const remain = remainMatch ? parseInt(remainMatch[1], 10) : 60;
      const reason = msg.includes('429') ? 'HTTP 429 Too Many Requests'
        : msg.includes('400') ? 'HTTP 400 Bad Request'
        : 'API Cooldown';
      emitRateLimit(url, reason, remain);
    }
    throw e;
  }
};

// ============ 全局单例（供 providers.ts 使用） ============
/**
 * 教学场景缓存配置：
 * - 天气数据：10 分钟 TTL
 * - 地震/自然事件：1 小时 TTL
 * - 气温/降水历史数据：24 小时 TTL
 * - 并发 ≤ 3/域名，请求间隔 ≥ 100ms
 */
export const apiCache = new CachedFetcher({
  ttlMs: 10 * 60 * 1000,
  cooldownMs: 60 * 1000,
  maxConcurrencyPerOrigin: 3,
  minRequestIntervalMs: 100,
});

/** 1 小时 TTL（地震/自然事件等慢更新数据） */
export const TTL_1H = 60 * 60 * 1000;
/** 10 分钟 TTL（天气） */
export const TTL_10M = 10 * 60 * 1000;
/** 24 小时 TTL（历史气温/降水） */
export const TTL_24H = 24 * 60 * 60 * 1000;
