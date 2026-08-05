/**
 * Q6 AppLoader —— 全屏启动加载屏：
 * - 纯色背景（和 Cesium 容器背景色一致，避免切换时色差闪烁）
 * - 居中 spinner + 百分比进度 + 阶段文案
 * - startupProgress 到达 100% 后 400ms opacity fade-out 再卸载 DOM，消除"加载完突然一跳"
 *
 * 进度来源：store.ui.startupProgress / startupLabel
 * 进度推进：CesiumCanvas 内部按阶段写入（初始化 / 底图瓦片 / 地形首帧 / 单例就绪 / 首次渲染完成）
 */

import { useEffect, useMemo, useState } from 'react';
import { useGeographyStore } from '../state/store';

/** 最大允许显示时间（毫秒）：防止异常卡死时启动屏永远不消失 */
const MAX_DISPLAY_MS = 18_000;
/** 到达 100% 后淡出动画时长（ms），须和 Tailwind transition duration 匹配 */
const FADE_OUT_MS = 400;
/** 进度"最后一公里"：当 Cesium 初始化完成但首渲染没回信号，保底 150ms 内由组件内部自举到 100，避免 stuck 在 98% */
const FINAL_NUDGE_MS = 150;

export function AppLoader() {
  const startupProgress = useGeographyStore((s) => s.ui.startupProgress) ?? 0;
  const startupLabel = useGeographyStore((s) => s.ui.startupLabel) ?? null;

  // visibleMounted：DOM 是否仍在渲染树中（100% 后先 fade-out，再卸载）
  const [visibleMounted, setVisibleMounted] = useState(true);
  // fadeOut：opacity 过渡到 0 的开关（startupProgress>=100 打开）
  const [fadeOut, setFadeOut] = useState(false);
  // 防御：超过 MAX_DISPLAY_MS 强行消失，避免加载失败白屏
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFadeOut(true);
      window.setTimeout(() => setVisibleMounted(false), FADE_OUT_MS);
    }, MAX_DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // 当启动进度达到 100% 时触发淡出
  useEffect(() => {
    if (startupProgress < 100) return;
    // 立即触发 opacity 过渡
    setFadeOut(true);
    // 过渡完成后卸载 DOM
    const t = window.setTimeout(() => setVisibleMounted(false), FADE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [startupProgress]);

  // Q6：显示百分比（夹到 0-100，避免负/溢出）
  const percent = useMemo(() => {
    const n = typeof startupProgress === 'number' ? startupProgress : 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }, [startupProgress]);

  // Q6：最后一公里"自举"——若 startupProgress 卡在 [92,100) 超过 FINAL_NUDGE_MS，内部平滑推到 100
  const [localBoost, setLocalBoost] = useState(0);
  useEffect(() => {
    if (startupProgress >= 100) return;
    if (startupProgress < 92) {
      setLocalBoost(0);
      return;
    }
    const t0 = window.setTimeout(() => setLocalBoost(100 - startupProgress), FINAL_NUDGE_MS);
    return () => window.clearTimeout(t0);
  }, [startupProgress]);
  const displayPercent = Math.min(100, percent + localBoost);

  // 展示的阶段文案：若无 label，则基于进度区间给出通用文案
  const showLabel = useMemo(() => {
    if (startupLabel) return startupLabel;
    if (displayPercent < 18) return '正在初始化环境…';
    if (displayPercent < 45) return '正在加载地球引擎…';
    if (displayPercent < 72) return '正在加载底图瓦片…';
    if (displayPercent < 92) return '正在加载地形数据…';
    return '正在完成最终渲染…';
  }, [startupLabel, displayPercent]);

  if (!visibleMounted) return null;

  return (
    <div
      data-testid="app-loader"
      aria-live="polite"
      aria-busy={displayPercent < 100}
      className={[
        'fixed inset-0 z-[120] flex flex-col items-center justify-center select-none',
        // 深空底色 + 径向辉光（与 app 整体深空风统一）
        'bg-[rgb(10,15,26)]',
        'transition-opacity ease-out',
        fadeOut ? 'opacity-0 duration-[400ms]' : 'opacity-100 duration-200',
      ].join(' ')}
      style={{
        // 径向青蓝辉光，模拟地球大气感
        background:
          'radial-gradient(ellipse at center, rgba(94,200,240,0.08) 0%, rgba(10,15,26,0) 55%), rgb(10,15,26)',
      }}
    >
      {/* ============ 主视觉：双圈轨道 + 地球核心 + 进度弧 ============ */}
      <div className="relative h-[160px] w-[160px]">
        {/* 外层轨道圈（极淡） */}
        <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full">
          <circle
            cx="80" cy="80" r="76"
            fill="none" strokeWidth="1"
            className="text-white/[0.06]"
            stroke="currentColor"
          />
          {/* 外圈进度弧（青蓝，主进度） */}
          <circle
            cx="80" cy="80" r="76"
            fill="none" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${Math.round(4.775 * displayPercent)} 478`}
            transform="rotate(-90 80 80)"
            className="transition-all duration-200 ease-out"
            stroke="rgb(94,200,240)"
            style={{ filter: 'drop-shadow(0 0 6px rgba(94,200,240,0.6))' }}
          />
        </svg>
        {/* 中层旋转弧（缓慢旋转，呼吸感） */}
        <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full animate-spin-slow">
          <circle
            cx="80" cy="80" r="62"
            fill="none" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray="20 360"
            stroke="rgba(94,200,240,0.45)"
          />
        </svg>
        {/* 内核：地球色发光球体（深空青蓝辉光锚点） */}
        <div
          className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 35% 30%, rgba(125,211,252,0.95) 0%, rgba(56,189,248,0.7) 35%, rgba(14,116,144,0.85) 70%, rgba(8,47,73,1) 100%)',
            boxShadow:
              '0 0 24px rgba(94,200,240,0.5), 0 0 48px rgba(56,189,248,0.25), inset -4px -6px 12px rgba(0,0,0,0.4)',
          }}
        />
        {/* 经纬线装饰（极淡，叠加在球体上） */}
        <svg viewBox="0 0 48 48" className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 opacity-30">
          <ellipse cx="24" cy="24" rx="22" ry="10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
          <ellipse cx="24" cy="24" rx="10" ry="22" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
          <line x1="2" y1="24" x2="46" y2="24" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
        </svg>
      </div>

      {/* ============ 百分比 ============ */}
      <div className="mt-8 font-sans text-5xl font-black tabular-nums tracking-tight text-white/90">
        {displayPercent}
        <span className="ml-1 text-2xl font-medium text-white/50">%</span>
      </div>

      {/* 阶段文案（青蓝主色） */}
      <div className="mt-3 text-sm tracking-wide" style={{ color: 'rgba(125,211,252,0.8)' }}>
        {showLabel}
      </div>

      {/* 装饰标语 */}
      <div className="mt-10 text-xs tracking-[0.35em] text-white/25">AI · GEOGRAPHY · CANVAS</div>
    </div>
  );
}
