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
