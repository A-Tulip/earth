/**
 * FpsDisplay —— 轻量级 FPS 显示组件 + 降级 tier 颜色点 + 实时打点 + 降级 Toast
 *
 * 显示条件：
 * - 开发模式：永久显示在角落
 * - 生产模式：按住 Alt 键显示（调试用）
 *
 * 不使用 React 状态（避免每 500ms setState 引起重渲染），直接操作 DOM。
 * 每次 tier 变化时在画面上方短暂显示"性能降级→Tier X"Toast，便于肉眼感知。
 */

import { useEffect, useRef } from 'react';
import { fpsLevel, type FpsLevel, getGlobalDegrader, DEGRADE_TIERS } from '../state/PerformanceMonitor';

export function FpsDisplay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const msRef = useRef<HTMLSpanElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const showInProduction = useRef(false);

  useEffect(() => {
    const devMode = import.meta.env.DEV ?? false;
    const container = containerRef.current;
    if (!container) return;

    // 最近 20 个样本（10s 窗口），用于 UI 上颜色 dots 渲染
    const samples: Array<{ fps: number; t: number }> = [];
    const SAMPLES_MAX = 20;

    // 默认显示逻辑
    const updateVisibility = () => {
      if (!container) return;
      const visible = devMode || showInProduction.current;
      container.style.display = visible ? 'flex' : 'none';
    };
    updateVisibility();

    // 生产模式：按住 Alt 显示
    const keyDown = (e: KeyboardEvent) => {
      if (!devMode && e.altKey) {
        showInProduction.current = true;
        updateVisibility();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (!devMode && !e.altKey) {
        showInProduction.current = false;
        updateVisibility();
      }
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);

    // Toast：降级时屏幕上方小提示
    const showToast = (msg: string, tone: 'up' | 'down') => {
      const old = toastRef.current;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      const el = document.createElement('div');
      el.textContent = msg;
      const baseCls =
        'pointer-events-none fixed left-1/2 z-[60] -translate-x-1/2 top-6 px-3 py-1.5 rounded-md text-xs font-medium font-sans backdrop-blur-md ring-1 transition-opacity';
      if (tone === 'down') {
        el.className =
          baseCls +
          ' bg-rose-900/60 text-rose-100 ring-rose-400/40';
      } else {
        el.className =
          baseCls +
          ' bg-emerald-900/60 text-emerald-100 ring-emerald-400/40';
      }
      el.style.opacity = '1';
      document.body.appendChild(el);
      toastRef.current = el;
      const t = window.setTimeout(() => {
        el.style.transition = 'opacity .6s ease';
        el.style.opacity = '0';
        const t2 = window.setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
          if (toastRef.current === el) toastRef.current = null;
        }, 650);
        // cleanup tie
        el.addEventListener('transitioncancel', () => window.clearTimeout(t2));
      }, 2600);
      el.dataset.timer = String(t);
    };

    // 订阅 Degrader tier 变化（Toast）
    const unsubTier = getGlobalDegrader().subscribe((t) => {
      const direction = t.next > t.prev ? 'down' : 'up';
      const arrow = direction === 'down' ? '↓' : '↑';
      showToast(
        `性能 ${arrow} Tier ${t.next}（${DEGRADE_TIERS[t.next].cesiumPixelRatio}x · avg ${t.avgFps.toFixed(0)} · min ${t.minFps.toFixed(0)}）`,
        direction,
      );
    });

    // 订阅 FPS 样本（Cesium 场景全局 FPS，通过 store 间接获取）
    let rafId: number;
    let lastLevel: FpsLevel | '' = '';
    let lastTier: number = -1;
    const update = () => {
      rafId = requestAnimationFrame(update);
      const store = (window as unknown as { _geographyFps?: { fps: number; ms: number; tier?: number } })._geographyFps;
      if (!store) return;
      const { fps, ms, tier } = store;
      if (fpsRef.current) fpsRef.current.textContent = fps.toString();
      if (msRef.current) msRef.current.textContent = ms.toFixed(1);
      // tier 变化时更新 tier 徽标
      if (typeof tier === 'number' && tier !== lastTier) {
        lastTier = tier;
        if (tierRef.current) tierRef.current.textContent = `T${tier}`;
      }
      // 实时打点（最近一次值）
      samples.push({ fps, t: Date.now() });
      while (samples.length > SAMPLES_MAX) samples.shift();
      const level = fpsLevel(fps);
      if (level !== lastLevel) {
        lastLevel = level;
        // 3 个颜色点按 level 高亮（5 dots = 近 5 个 sample level，简单用 className 切）
        if (level === 'good') {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded-md bg-ink-900/70 px-2.5 py-1 font-mono text-[11px] text-emerald-400 ring-1 ring-emerald-400/30 backdrop-blur-sm';
        } else if (level === 'warn') {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded-md bg-ink-900/70 px-2.5 py-1 font-mono text-[11px] text-amber-400 ring-1 ring-amber-400/30 backdrop-blur-sm';
        } else {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded-md bg-ink-900/70 px-2.5 py-1 font-mono text-[11px] text-rose-400 ring-1 ring-rose-400/30 backdrop-blur-sm';
        }
      }
    };
    rafId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      cancelAnimationFrame(rafId);
      unsubTier();
      if (toastRef.current) {
        if (toastRef.current.parentNode) toastRef.current.parentNode.removeChild(toastRef.current);
        toastRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-2 rounded-md bg-ink-900/70 px-2.5 py-1 font-mono text-[11px] text-emerald-400 ring-1 ring-emerald-400/30 backdrop-blur-sm"
      title="FPS (DEV 常驻；生产按 Alt 显示；T0-3 自适应降级档)"
    >
      <span className="rounded border border-white/15 px-1 py-[1px] text-[9px] tracking-wider text-white/60" ref={tierRef}>T0</span>
      <span>FPS</span>
      <span ref={fpsRef} className="font-bold tabular-nums">--</span>
      <span className="text-white/40">·</span>
      <span ref={msRef} className="text-white/70 tabular-nums">--</span>
      <span className="text-white/50">ms</span>
    </div>
  );
}
