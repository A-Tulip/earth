/**
 * AppLoader —— 极简启动加载屏（与 LoadingOverlay 同一套视觉语言）：
 * - 深空底色（与 Cesium 容器背景一致，避免切换色差闪烁）
 * - 单一细描边 spinner + 百分比 + 阶段文案
 * - startupProgress 到达 100% 后淡出再卸载 DOM，消除"加载完突然一跳"
 *
 * 进度来源：store.ui.startupProgress / startupLabel / layerBusy
 * 进度推进：CesiumCanvas 内部按阶段写入（初始化 / 底图瓦片 / 地形首帧 / 单例就绪 / 首次渲染完成）
 */

import { useEffect, useMemo, useState } from 'react';
import { useGeographyStore } from '../state/store';

/** 最大允许显示时间（毫秒）：防止异常卡死时启动屏永远不消失 */
const MAX_DISPLAY_MS = 18_000;
/** 到达 100% 后淡出动画时长（ms），须和 transition duration 匹配 */
const FADE_OUT_MS = 400;
/** 进度"最后一公里"：启动进度卡在 [92,100) 时内部自举到 100，避免 stuck */
const FINAL_NUDGE_MS = 150;

export function AppLoader() {
  const startupProgress = useGeographyStore((s) => s.ui.startupProgress) ?? 0;
  const startupLabel = useGeographyStore((s) => s.ui.startupLabel) ?? null;

  const [visibleMounted, setVisibleMounted] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  // 防御：超过 MAX_DISPLAY_MS 强行消失，避免加载失败白屏
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFadeOut(true);
      window.setTimeout(() => setVisibleMounted(false), FADE_OUT_MS);
    }, MAX_DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // 启动进度达到 100% 时触发淡出
  useEffect(() => {
    if (startupProgress < 100) return;
    setFadeOut(true);
    const t = window.setTimeout(() => setVisibleMounted(false), FADE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [startupProgress]);

  // 显示百分比（夹到 0-100）
  const percent = useMemo(() => {
    const n = typeof startupProgress === 'number' ? startupProgress : 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }, [startupProgress]);

  // 最后一公里自举：卡在 [92,100) 时内部平滑推到 100
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

  // 阶段文案：无 label 时基于进度区间给出通用文案
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
        'bg-[rgb(10,15,26)]',
        'transition-opacity ease-out',
        fadeOut ? 'opacity-0 duration-[400ms]' : 'opacity-100 duration-200',
      ].join(' ')}
    >
      {/* 单一细描边 spinner：与 LoadingOverlay 视觉一致，无第二层环、无辉光 */}
      <div className="relative h-10 w-10" aria-hidden="true">
        <svg viewBox="0 0 40 40" className="h-full w-full animate-spin-slow">
          <circle
            cx="20" cy="20" r="16"
            fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2"
          />
          <circle
            cx="20" cy="20" r="16"
            fill="none" stroke="#5ec8f0" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="72 28"
          />
        </svg>
      </div>

      {/* 百分比 */}
      <div className="mt-5 font-sans text-2xl font-bold tabular-nums tracking-tight text-white/90">
        {displayPercent}
        <span className="ml-0.5 text-sm font-medium text-white/50">%</span>
      </div>

      {/* 阶段文案 */}
      <div className="mt-2 text-sm tracking-wide text-white/50">{showLabel}</div>
    </div>
  );
}