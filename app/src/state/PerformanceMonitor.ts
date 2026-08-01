/**
 * PerformanceMonitor —— 轻量级性能监控（FPS 计数器 + rAF 节流）
 *
 * 问题：Cesium requestRenderMode=true 时，clock.onTick 每帧都会触发回调，
 * 回调内若有复杂计算会导致 [Violation] 'requestAnimationFrame' handler took Xms。
 *
 * 解决思路：
 * 1. 非实时逻辑（自转、直射点更新、大气更新）按需降采样，不一定每帧执行
 * 2. 使用 shouldTick(intervalMs) 限制每帧回调的执行频率
 * 3. FPS 监控帮助识别性能瓶颈（仅开发环境显示，生产环境可关闭）
 * 4. AdaptiveDegrader：根据 3 秒滑动平均 FPS 分 4 级自适应降级，自动
 *    调整 Cesium/Three.js 像素比、地形细节、阴影、雾效、标签密度。
 */

/** FPS 配置 */
const FPS_CONFIG = {
  windowSize: 30,     // 移动平均窗口大小（帧）
  updateIntervalMs: 500,  // 多少毫秒更新一次 FPS 显示
  warnThreshold: 30,  // FPS 低于此值显示黄色警告
  criticalThreshold: 15,  // FPS 低于此值显示红色警告
};

/** 节流控制：返回是否应该在这一帧执行逻辑 */
export function createTickThrottle(intervalMs: number) {
  let lastTick = 0;
  return function shouldTick(nowMs = Date.now()): boolean {
    if (nowMs - lastTick >= intervalMs) {
      lastTick = nowMs;
      return true;
    }
    return false;
  };
}

/** FPS 计数器：使用移动平均计算 */
export class FpsCounter {
  private frames: number[] = []; // 每帧耗时（ms）
  private lastTime: number = 0;
  private lastReport: number = 0;
  private currentFps: number = 60;
  private listeners: Set<(fps: number, avgFrameMs: number) => void> = new Set();

  /** 每帧调用一次，返回当前 FPS（移动平均） */
  tick(): number {
    const now = performance.now();
    if (this.lastTime > 0) {
      const delta = now - this.lastTime;
      this.frames.push(delta);
      if (this.frames.length > FPS_CONFIG.windowSize) {
        this.frames.shift();
      }
      // 每隔 updateIntervalMs 更新一次 FPS（避免每帧计算均值）
      if (now - this.lastReport >= FPS_CONFIG.updateIntervalMs) {
        this.lastReport = now;
        const avgMs = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        this.currentFps = avgMs > 0 ? Math.min(120, Math.round(1000 / avgMs)) : 0;
        this.listeners.forEach((cb) => cb(this.currentFps, avgMs));
      }
    }
    this.lastTime = now;
    return this.currentFps;
  }

  /** 订阅 FPS 更新 */
  subscribe(cb: (fps: number, avgFrameMs: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 最近一次的 FPS 值 */
  get(): number {
    return this.currentFps;
  }

  /** 重置统计 */
  reset(): void {
    this.frames = [];
    this.lastTime = 0;
    this.lastReport = 0;
    this.currentFps = 60;
  }
}

/** FPS 状态级别 */
export type FpsLevel = 'good' | 'warn' | 'critical';

export function fpsLevel(fps: number): FpsLevel {
  if (fps <= FPS_CONFIG.criticalThreshold) return 'critical';
  if (fps <= FPS_CONFIG.warnThreshold) return 'warn';
  return 'good';
}

/* ================================================================
   § AdaptiveDegrader —— 自适应降级（4 档）
   ================================================================ */

/** 降级级别：数值越大渲染越粗糙；-1 表示尚未初始化 */
export type DegradeTier = 0 | 1 | 2 | 3;

export interface DegradeConfig {
  tier: DegradeTier;
  /** Cesium 像素比；1.0 高清，0.75 平衡，0.5 性能 */
  cesiumPixelRatio: number;
  /** Three.js / 太阳系像素比上限 */
  solarPixelRatioClamp: number;
  /** 是否关闭 Cesium 地面阴影/辉光外溢（MSAA/后处理负担） */
  disableGroundShadows: boolean;
  /** 地形夸张倍数（tier↑ 降低视觉负担，夸张越低 → 顶点着色越便宜） */
  terrainExaggeration: number;
  /** Globe 瓦片采样率；1.0 默认，越低瓦片越少 */
  globeTileCacheSize: number;
  /** 标签 LOD 全局压缩系数（0.5 表示把预算折半） */
  labelLODFactor: number;
  /** 雾密度（关闭：0；启用：0.0001）；雾可遮蔽远处瓦片请求，降低 GPU 负担 */
  fogDensity: number;
  /** MSAA 采样数（1/2/4）；tier2+ 设为 1 可省全屏 resolve */
  msaaSamples: number;
  /** 星空是否动画（高负载设备关闭 twinkle 动画） */
  starfieldAnimated: boolean;
}

export const DEGRADE_TIERS: Record<DegradeTier, DegradeConfig> = {
  /** Tier 0 —— 高性能设备默认档（高刷） */
  0: {
    tier: 0,
    cesiumPixelRatio: 1.0,
    solarPixelRatioClamp: 1.25,
    disableGroundShadows: false,
    terrainExaggeration: 2.2,
    globeTileCacheSize: 1000,
    labelLODFactor: 1.0,
    fogDensity: 0.0001,
    msaaSamples: 4,
    starfieldAnimated: true,
  },
  /** Tier 1 —— 平衡档（笔记本/手机中高端） */
  1: {
    tier: 1,
    cesiumPixelRatio: 0.75,
    solarPixelRatioClamp: 1.0,
    disableGroundShadows: false,
    terrainExaggeration: 1.8,
    globeTileCacheSize: 700,
    labelLODFactor: 0.8,
    fogDensity: 0.00012,
    msaaSamples: 2,
    starfieldAnimated: true,
  },
  /** Tier 2 —— 性能优先（集显/旧平板） */
  2: {
    tier: 2,
    cesiumPixelRatio: 0.6,
    solarPixelRatioClamp: 0.85,
    disableGroundShadows: true,
    terrainExaggeration: 1.5,
    globeTileCacheSize: 450,
    labelLODFactor: 0.6,
    fogDensity: 0.00018,
    msaaSamples: 1,
    starfieldAnimated: false,
  },
  /** Tier 3 —— 应急保命档（低端机/后台） */
  3: {
    tier: 3,
    cesiumPixelRatio: 0.5,
    solarPixelRatioClamp: 0.7,
    disableGroundShadows: true,
    terrainExaggeration: 1.2,
    globeTileCacheSize: 300,
    labelLODFactor: 0.45,
    fogDensity: 0.00025,
    msaaSamples: 1,
    starfieldAnimated: false,
  },
};

export interface TierTransition {
  prev: DegradeTier;
  next: DegradeTier;
  /** 此次降级/升级 3s 滑动平均 FPS */
  avgFps: number;
  /** 1s 窗口内最差 FPS（尖刺敏感） */
  minFps: number;
}

/**
 * 自适应降级器：
 *
 * - 输入：每 500ms 一次 (fps, avgFrameMs)，由 FpsCounter 推送
 * - 内部：环形 6 槽滑动窗口（≈3 秒覆盖），记录 fps 值
 * - 触发：
 *   - 升级（画质↑）：avg≥55 & min≥45 持续 2 个采样周期 → tier -1
 *   - 降级（性能↑）：avg<25 或 min<12 → tier +1
 * - 迟滞：降级后至少 8 秒冻结期，冷却后再评估升级，避免抖动
 * - 迟滞：升级后至少 6 秒不降级，防止刚升就掉
 */
export class AdaptiveDegrader {
  private readonly window: number[] = [];
  private readonly WINDOW_SIZE = 6; // 6 * 500ms = 3s
  private _tier: DegradeTier = 0;
  private nextChangeAt = 0; // epoch ms，此后才允许 tier 变动
  private lastMin = 60;
  private lastAvg = 60;
  private listeners = new Set<(t: TierTransition) => void>();
  private sampleListeners = new Set<(fps: number, avgMs: number) => void>();

  /** 起始档默认 0；可在 DEV 里通过 get/setTier 手动切档测试 */
  get tier(): DegradeTier { return this._tier; }
  get config(): DegradeConfig { return DEGRADE_TIERS[this._tier]; }
  /** 上一轮评估时 3s 窗口平均值 */
  get lastAvgFps(): number { return this.lastAvg; }
  /** 上一轮评估时 3s 窗口最小值 */
  get lastMinFps(): number { return this.lastMin; }

  /** 订阅 tier 变化（用于 Cesium/Three 应用具体策略） */
  subscribe(cb: (t: TierTransition) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 订阅 FPS 样本（用于 FpsDisplay 实时打点/Toast） */
  subscribeSamples(cb: (fps: number, avgMs: number) => void): () => void {
    this.sampleListeners.add(cb);
    return () => this.sampleListeners.delete(cb);
  }

  /** 外部调用：给一个 FPS 样本（一般由 FpsCounter.subscribe 触发） */
  feed(fps: number, avgFrameMs: number): void {
    this.sampleListeners.forEach((cb) => { try { cb(fps, avgFrameMs); } catch { /* ignore */ } });
    // 入窗
    this.window.push(fps);
    while (this.window.length > this.WINDOW_SIZE) this.window.shift();
    if (this.window.length < 4) return; // 先攒 ~2s 数据再评估
    this.lastAvg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    this.lastMin = Math.min(...this.window);
    this.evaluate();
  }

  /** 手动强制切档（调试/性能面板用）；跳过冷却期 */
  setTier(t: DegradeTier): void {
    if (t === this._tier) return;
    const prev = this._tier;
    this._tier = t;
    this.nextChangeAt = Date.now() + 4000; // 强制切后也给 4s 缓冲
    this.emit({ prev, next: t, avgFps: this.lastAvg, minFps: this.lastMin });
  }

  private evaluate(): void {
    const now = Date.now();
    const prev = this._tier;
    const { lastAvg: avg, lastMin: min } = this;

    // 降级：触发宽松（持续差就降）
    if (now >= this.nextChangeAt) {
      const shouldDegrade =
        (avg < 25) ||            // 均值持续 <25 —— 卡顿
        (min < 12 && avg < 40);  // 尖刺严重 + 均值不高 → 降级
      if (shouldDegrade && prev < 3) {
        this._tier = (prev + 1) as DegradeTier;
        this.nextChangeAt = now + 8000; // 降级后 8 秒不升
        this.emit({ prev, next: this._tier, avgFps: avg, minFps: min });
        return;
      }
    }

    // 升级：触发严格（均值≥55 & min≥45 → 真有余量）
    if (now >= this.nextChangeAt && prev > 0) {
      const shouldUpgrade = avg >= 55 && min >= 45;
      if (shouldUpgrade) {
        this._tier = (prev - 1) as DegradeTier;
        this.nextChangeAt = now + 6000; // 升级后 6 秒不降
        this.emit({ prev, next: this._tier, avgFps: avg, minFps: min });
        return;
      }
    }
  }

  private emit(t: TierTransition): void {
    this.listeners.forEach((cb) => { try { cb(t); } catch { /* noop */ } });
  }
}

/* ------------------- 全局单例（CesiumCanvas / SolarEngine / FpsDisplay 共用） ------------------- */
let _global: AdaptiveDegrader | null = null;
export function getGlobalDegrader(): AdaptiveDegrader {
  if (!_global) _global = new AdaptiveDegrader();
  return _global;
}
