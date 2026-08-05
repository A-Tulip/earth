import { useEffect, useRef, useState } from 'react';
import type { LayerErrorCategory, LayerErrorKind } from '../state/sceneState';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';

const KIND_LABEL: Record<LayerErrorKind, string> = {
  basemap: '底图图层',
  terrain: '地形图层',
  sceneMode: '视图切换',
  annotation: '标注图层',
  data: '数据图层',
  globeMaterial: '地貌材质',
  lessons: '课程加载',
  ai: 'AI 服务',
  unknown: '图层操作',
};

const CAT_LABEL: Record<LayerErrorCategory, { title: string; hint: string; tone: 'rose' | 'amber' | 'sky' | 'slate' }> = {
  network:    { title: '网络连接异常',   hint: '请检查网络，或稍后重试',                      tone: 'rose' },
  not_found:  { title: '资源不存在',     hint: '相关瓦片或数据服务暂不可用',                  tone: 'amber' },
  invalid_args: { title: '参数错误',     hint: '请求参数不合法，请稍后重试',                  tone: 'amber' },
  auth:       { title: '认证失败',       hint: '地图/服务 API Key 无效或缺失',                tone: 'amber' },
  render:     { title: '渲染失败',       hint: 'WebGL 渲染异常，已自动尝试回退',              tone: 'rose' },
  timeout:    { title: '加载超时',       hint: '服务器响应慢，已停止等待',                    tone: 'amber' },
  rate_limit: { title: '请求过于频繁',   hint: '已触发限流，请稍后再试',                      tone: 'sky' },
  unknown:    { title: '图层切换失败',   hint: '未知错误，已自动回退到上一层',                tone: 'slate' },
};

export function LayerErrorModal() {
  const msg = useGeographyStore((s) => s.ui.lastLayerError);
  const at = useGeographyStore((s) => s.ui.lastLayerErrorAt);
  const category = useGeographyStore((s) => s.ui.lastLayerErrorCategory);
  const kind = useGeographyStore((s) => s.ui.lastLayerErrorKind);
  const retryAction = useGeographyStore((s) => s.ui.lastLayerErrorRetryAction);

  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);   // 用于 fade in/out
  const lastAtRef = useRef<string | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);

  // 新错误到达：显示模态卡；若错误码完全相同则不重复闪（防止订阅抖动）
  useEffect(() => {
    if (!msg || !at) {
      // 外部主动清空 → 立即淡出
      if (mounted) {
        setShow(false);
        if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = window.setTimeout(() => setMounted(false), 220);
      }
      return;
    }
    if (at === lastAtRef.current && mounted) return; // 同一个错误，不重复弹
    lastAtRef.current = at;
    setMounted(true);
    // next tick → fade-in
    const id = window.setTimeout(() => setShow(true), 10);
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    // 14s 自动关闭（用户可以手动关；若需重试，会在关闭前点按钮）
    autoCloseTimerRef.current = window.setTimeout(() => {
      setShow(false);
      if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = window.setTimeout(() => {
        setMounted(false);
        // 同步清空 store 字段，避免再次进来同一个 at 被拦截
        const store = useGeographyStore.getState();
        try {
          store.setUI({
            lastLayerError: null,
            lastLayerErrorAt: null,
            lastLayerErrorCategory: null,
            lastLayerErrorKind: null,
            lastLayerErrorRetryAction: null,
          } as unknown as Parameters<typeof store.setUI>[0]);
        } catch { /* ignore */ }
      }, 260);
    }, 14_000);
    return () => {
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg, at]);

  useEffect(() => {
    return () => {
      if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
      if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    };
  }, []);

  const close = () => {
    setShow(false);
    if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      lastAtRef.current = null;
      const store = useGeographyStore.getState();
      try {
        store.setUI({
          lastLayerError: null,
          lastLayerErrorAt: null,
          lastLayerErrorCategory: null,
          lastLayerErrorKind: null,
          lastLayerErrorRetryAction: null,
        } as unknown as Parameters<typeof store.setUI>[0]);
      } catch { /* ignore */ }
    }, 240);
  };

  const retry = async () => {
    if (!retryAction) return;
    close();
    try {
      await commandBus.execute({
        name: retryAction.name as Parameters<typeof commandBus.execute>[0]['name'],
        args: retryAction.args,
      });
    } catch {
      /* never throw */
    }
  };

  if (!mounted || !msg || !at) return null;

  const cat = category ? CAT_LABEL[category] : CAT_LABEL.unknown;
  const tone: 'rose' | 'amber' | 'sky' | 'slate' = cat.tone;

  const toneStyles = {
    rose:  { ring: 'ring-rose-500/40',  chip: 'bg-rose-500/15 text-rose-200 border-rose-400/30',  accent: 'text-rose-300',  icon: 'text-rose-300' },
    amber: { ring: 'ring-amber-500/40', chip: 'bg-amber-500/15 text-amber-200 border-amber-400/30', accent: 'text-amber-300', icon: 'text-amber-300' },
    sky:   { ring: 'ring-sky-500/40',   chip: 'bg-sky-500/15 text-sky-200 border-sky-400/30',     accent: 'text-sky-300',   icon: 'text-sky-300' },
    slate: { ring: 'ring-slate-500/40', chip: 'bg-slate-500/15 text-slate-200 border-slate-400/30', accent: 'text-slate-300', icon: 'text-slate-300' },
  }[tone];

  const kindLabel = kind ? KIND_LABEL[kind] : KIND_LABEL.unknown;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{
        pointerEvents: 'none',
        transition: 'opacity 220ms ease',
        opacity: show ? 1 : 0,
      }}
      role="alertdialog"
      aria-modal="false"
      aria-label="图层错误提示"
      onClick={() => { /* 点击背景不关闭：避免误点。关只能按 × 或等自动 */ }}
    >
      {/* 浅 dim 遮罩：让用户注意到模态，同时不阻挡下方主画布（pointer-events:none 父） */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 40%, rgba(10,15,26,0.55) 0%, rgba(5,8,16,0.28) 60%, rgba(5,8,16,0.0) 100%)',
          backdropFilter: 'blur(1px)',
        }}
      />
      <div
        className={`relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-md ring-1 ${toneStyles.ring}`}
        style={{
          pointerEvents: 'auto',
          transform: show ? 'translateY(0) scale(1)' : 'translateY(12px) scale(.97)',
          transition: 'transform 240ms cubic-bezier(.2,.8,.2,1.05)',
        }}
      >
        <div className="flex items-start gap-3">
          {/* 图标 */}
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 ${toneStyles.icon}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold leading-6 text-white">
                    {cat.title}
                  </h3>
                  <span className={`rounded-md border px-2 py-[1px] text-[11px] ${toneStyles.chip}`}>
                    {kindLabel}
                  </span>
                </div>
                <p className={`mt-0.5 text-[12.5px] leading-5 ${toneStyles.accent}`}>
                  {cat.hint}
                </p>
              </div>
              <button
                type="button"
                data-agent-button="layerError.closeIcon"
                onClick={close}
                aria-label="关闭错误提示"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white active:bg-white/15"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            {/* 具体错误信息（可复制） */}
            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-[12px] font-medium uppercase tracking-wider text-slate-400">错误详情</div>
              <div className="mt-1 break-words text-[13px] leading-5 text-slate-100/90 select-text">
                {msg}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>{new Date(at).toLocaleString()}</span>
                <span className="text-slate-500">已自动回退到上一层</span>
              </div>
            </div>
          </div>
        </div>

        {/* 操作区：重试 + 关闭 */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-agent-button="layerError.close"
            onClick={close}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white active:bg-white/15"
          >
            关闭
          </button>
          {retryAction ? (
            <button
              type="button"
              data-agent-button="layerError.retry"
              onClick={retry}
              className={`group inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white shadow-lg transition active:translate-y-[1px] ${tone === 'rose' ? 'bg-rose-500 hover:bg-rose-400' : tone === 'amber' ? 'bg-amber-500 hover:bg-amber-400' : tone === 'sky' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform duration-500 group-hover:rotate-[-200deg]">
                <path d="M21 12a9 9 0 1 1-3.2-6.9" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              重试
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
