/**
 * FpsDisplay —— 轻量级 FPS 显示组件
 *
 * 显示条件：
 * - 开发模式：永久显示在角落
 * - 生产模式：按住 Alt 键显示（调试用）
 *
 * 不使用 React 状态（避免每帧 setState 引起重渲染），直接操作 DOM。
 */

import { useEffect, useRef } from 'react';
import { fpsLevel, type FpsLevel } from '../state/PerformanceMonitor';

export function FpsDisplay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const msRef = useRef<HTMLSpanElement>(null);
  const showInProduction = useRef(false);

  useEffect(() => {
    const devMode = import.meta.env.DEV ?? false;
    const container = containerRef.current;
    if (!container) return;

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

    // 订阅 FPS 更新（Cesium 场景全局 FPS，通过 store 间接获取）
    let rafId: number;
    let lastLevel: FpsLevel | '' = '';
    const update = () => {
      rafId = requestAnimationFrame(update);
      const store = (window as unknown as { _geographyFps?: { fps: number; ms: number } })._geographyFps;
      if (!store) return;
      const { fps, ms } = store;
      if (fpsRef.current) fpsRef.current.textContent = fps.toString();
      if (msRef.current) msRef.current.textContent = ms.toFixed(1);
      const level = fpsLevel(fps);
      if (level !== lastLevel) {
        lastLevel = level;
        if (level === 'good') {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-1.5 rounded-md bg-ink-900/70 px-2 py-1 font-mono text-xs text-emerald-400 ring-1 ring-emerald-400/30 backdrop-blur-sm';
        } else if (level === 'warn') {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-1.5 rounded-md bg-ink-900/70 px-2 py-1 font-mono text-xs text-amber-400 ring-1 ring-amber-400/30 backdrop-blur-sm';
        } else {
          container.className =
            'pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-1.5 rounded-md bg-ink-900/70 px-2 py-1 font-mono text-xs text-rose-400 ring-1 ring-rose-400/30 backdrop-blur-sm';
        }
      }
    };
    rafId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed bottom-2 right-2 z-50 flex items-center gap-1.5 rounded-md bg-ink-900/70 px-2 py-1 font-mono text-xs text-emerald-400 ring-1 ring-emerald-400/30 backdrop-blur-sm"
      title="FPS (按 Alt 在生产模式下查看)"
    >
      <span>FPS</span>
      <span ref={fpsRef} className="font-bold">--</span>
      <span className="text-white/40">·</span>
      <span ref={msRef} className="text-white/70">--</span>
      <span className="text-white/50">ms</span>
    </div>
  );
}
