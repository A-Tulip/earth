import { useEffect, useState } from 'react';
import { useGeographyStore } from '../state/store';
import type { TransientUIState } from '../state/sceneState';

type BusyKind = keyof NonNullable<TransientUIState['layerBusy']>;

const KIND_LABEL: Record<BusyKind, string> = {
  basemap: '正在切换底图…',
  terrain: '正在加载地形…',
  sceneMode: '正在切换视图模式…',
  annotation: '正在加载注记图层…',
  data: '正在加载数据图层…',
  globeMaterial: '正在生成地形效果…',
};

/**
 * Q2 图层切换加载动画（Cursor warm-cream editorial 风格）：
 * 设计原则（与 Cursor marketing site 对齐）：
 *   - 单电压色：Cursor Orange #f54e00 做单一描边 spinner，无任何第二色
 *   - 画布底色：温暖米白 #f7f7f4
 *   - 正文：暖墨 #26251e（而非纯黑，更柔和但对比度足够）
 *   - 卡片：只有 1px hairline（无双层边框、无阴影、无玻璃态彩色辉光）
 *   - 节奏：显示延迟 70ms 避免快切闪；消失延迟 140ms 做一个 fade out
 */
export function LoadingOverlay() {
  const layerBusy = useGeographyStore((s) => s.ui.layerBusy);
  const [shown, setShown] = useState(false);
  const [label, setLabel] = useState('正在加载…');

  useEffect(() => {
    const kinds = (Object.keys(layerBusy ?? {}) as BusyKind[]).filter((k) => layerBusy?.[k]);
    const anyBusy = kinds.length > 0;

    let mountTimer: number | null = null;
    let unmountTimer: number | null = null;

    if (anyBusy) {
      setLabel(KIND_LABEL[kinds[0]] ?? '正在加载…');
      // 70ms 延迟：避免 <1 帧的操作也闪一下遮罩
      mountTimer = window.setTimeout(() => setShown(true), 70);
    } else {
      if (mountTimer) window.clearTimeout(mountTimer);
      // 140ms 退出延迟：做一个短 fade，同时避免"切完还没渲染完整帧就立刻消失"抖动
      unmountTimer = window.setTimeout(() => setShown(false), 140);
    }
    return () => {
      if (mountTimer) window.clearTimeout(mountTimer);
      if (unmountTimer) window.clearTimeout(unmountTimer);
    };
  }, [layerBusy]);

  if (!shown) return null;

  return (
    <div
      data-testid="loading-overlay"
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in duration-150"
      style={{ backgroundColor: 'rgba(247, 247, 244, 0.62)' }}
      aria-live="polite"
      aria-busy="true"
    >
      {/* hairline 边框卡片：暖色白底 + 1px 暖墨描边 + 轻微硬阴影（Cursor 风格：8x8 偏移纯色） */}
      <div
        className="flex items-center gap-4 px-6 py-4"
        style={{
          backgroundColor: '#f7f7f4',
          color: '#26251e',
          border: '1px solid #26251e',
          boxShadow: '8px 8px 0 0 rgba(0,0,0,0.08)',
          borderRadius: 0, // 硬边直角（编辑杂志风，不做圆角）
          fontSize: 13.5,
          letterSpacing: '0.02em',
        }}
      >
        {/* Spinner：单一 Cursor Orange 描边环，无第二层环、无彩虹色、无 pulse */}
        <div className="relative h-7 w-7" aria-hidden="true">
          <svg viewBox="0 0 36 36" className="h-full w-full animate-spin-slow">
            {/* 背景轨道：1px 暖墨 hairline */}
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="#26251e"
              strokeOpacity="0.12"
              strokeWidth="1"
            />
            {/* 进度弧：单一 Cursor Orange，dash 约 72% 缺口 28%，圆润端点 */}
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="#f54e00"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="72 28"
            />
          </svg>
        </div>
        {/* 文字：暖墨 tabular-nums，与营销站点 display 字体风格同权重（普通 400 即可，body 字重） */}
        <div className="tracking-wide" style={{ fontFamily: 'CursorGothic, system-ui, -apple-system, sans-serif' }}>
          {label}
        </div>
      </div>
    </div>
  );
}
