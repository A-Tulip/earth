/**
 * App —— 应用根组件
 *
 * AI 地理画布：
 * - 打开即看到完整地球
 * - 无登录、无欢迎流程、无 API 配置
 * - 按住空格语音、工具坞手动操作
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from 'react';
import { CesiumCanvas } from './cesium/CesiumCanvas';
import { CesiumLayerSync } from './cesium/CesiumLayerSync';
import { CesiumController } from './cesium/controller';
import { TopBar } from './ui/TopBar';
import { ToolDock } from './ui/ToolDock';
import { CommandMenu } from './ui/CommandMenu';
import { SubtitleLayer } from './ui/SubtitleLayer';
import { Starfield } from './ui/Starfield';
import { Guidance } from './ui/Guidance';
import { FpsDisplay } from './ui/FpsDisplay';
import { HelpPanel } from './ui/HelpPanel';
import { isEditable } from './voice/PushToTalk';
import { Mic } from './ui/icons';
import { usePushToTalk } from './voice/PushToTalk';
import { useRealtimeVoiceChat } from './voice/RealtimeVoiceChat';
import { createASRAdapter, createTTSAdapter, createLLMAdapter } from './voice/adapters';
import { LessonRuntime } from './lessons/runtime';
import { commandBus } from './commands/bus';
import { useGeographyStore } from './state/store';
import { onRateLimit, type RateLimitEvent } from './state/CachedFetcher';

// Three.js 太阳系视图懒加载：地球视图首屏不负担 ~600KB 的 Three.js chunk
const SolarSystemCanvas = lazy(() =>
  import('./solar-system/SolarSystemCanvas').then((m) => ({ default: m.SolarSystemCanvas })),
);

export default function App() {
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [, setControllerReady] = useState(false);
  const lessonRuntimeRef = useRef<LessonRuntime | null>(null);
  const store = useGeographyStore;
  const solarSystemActive = useGeographyStore((s) => s.solarSystemActive);

  // 暴露 store setState 到 window（仅开发调试 + E2E 测试使用，不依赖此做功能使用）
  useEffect(() => {
    const w = window as unknown as { _geographyStoreDebug?: { setState: (p: any) => void } };
    w._geographyStoreDebug = { setState: (p) => useGeographyStore.setState(p) };
  }, []);

  // ======== LayerLifeCycleManager 错误 Toast（lastLayerError 变更显示 6s 红色提示）
  const [layerError, setLayerError] = useState<{ msg: string; at: string } | null>(null);
  const layerErrorClearTimer = useRef<number | null>(null);
  const lastErrorAtRef = useRef<string | null>(null);
  const layerErrorMsg = useGeographyStore((s) => s.ui.lastLayerError);
  const layerErrorAt = useGeographyStore((s) => s.ui.lastLayerErrorAt);
  useEffect(() => {
    if (!layerErrorMsg || !layerErrorAt) {
      // 被显式清空 → UI 同步清空
      if (layerErrorClearTimer.current) window.clearTimeout(layerErrorClearTimer.current);
      layerErrorClearTimer.current = null;
      setLayerError(null);
      lastErrorAtRef.current = null;
      return;
    }
    // 与上次一样 → 重复信号，不重触发
    if (layerErrorAt === lastErrorAtRef.current) return;
    lastErrorAtRef.current = layerErrorAt;
    setLayerError({ msg: layerErrorMsg, at: layerErrorAt });
    if (layerErrorClearTimer.current) window.clearTimeout(layerErrorClearTimer.current);
    // 6 秒自动隐藏，并清除 store 错误以便下一条错误能再次触发
    layerErrorClearTimer.current = window.setTimeout(() => {
      setLayerError(null);
      useGeographyStore.setState({
        ui: {
          ...useGeographyStore.getState().ui,
          lastLayerError: null,
          lastLayerErrorAt: null,
        },
      });
    }, 6000);
  }, [layerErrorMsg, layerErrorAt]);

  // ? 键唤起帮助面板（Shift+/，避免在输入框中触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 创建语音适配器（单例）
  const asrRef = useRef(createASRAdapter());
  const ttsRef = useRef(createTTSAdapter());
  const llmRef = useRef(createLLMAdapter());

  // 实时对话模式状态（启用时禁用 Push-to-Talk）
  const realtimeChatActive = useGeographyStore((s) => s.voice.realtimeChatActive);

  // Push-to-Talk（实时对话模式启用时禁用）
  const { toggleRecording, interrupt } = usePushToTalk({
    asr: asrRef.current,
    tts: ttsRef.current,
    llm: llmRef.current,
    enabled: !realtimeChatActive,
  });

  // 实时对话模式（全双工，VAD 自动检测）
  const { toggleRealtimeChat } = useRealtimeVoiceChat({
    asr: asrRef.current,
    tts: ttsRef.current,
    llm: llmRef.current,
    enabled: realtimeChatActive,
  });

  // Cesium 就绪回调（命令处理器由 CesiumCanvas 内部注册一次）
  const handleCesiumReady = useCallback((controller: CesiumController) => {
    commandBus.setContext({ cesium: controller });

    // 创建课程运行时
    const runtime = new LessonRuntime();
    lessonRuntimeRef.current = runtime;
    commandBus.setContext({ lesson: runtime });

    setControllerReady(true);
  }, []);

  // 静音切换
  const toggleMute = useCallback(() => {
    const muted = !store.getState().voice.muted;
    store.getState().setVoice({ muted });
    if (muted) {
      ttsRef.current.stop();
      interrupt();
    }
  }, [store, interrupt]);

  // 教师说话时打断课程旁白（仅在 listening 从 false→true 时触发）
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const unsubscribe = store.subscribe((state) => {
      const nowListening = state.voice.listening;
      if (nowListening && !prevListeningRef.current && lessonRuntimeRef.current) {
        lessonRuntimeRef.current.interrupt();
      }
      prevListeningRef.current = nowListening;
    });
    return unsubscribe;
  }, [store]);

  // ======== API 限流提示（issue #18）========
  // 监听 CachedFetcher 的限流事件，显示 Toast 用户提示，几秒后自动消失
  const [rateLimitToast, setRateLimitToast] = useState<RateLimitEvent | null>(null);
  const rateLimitClearTimer = useRef<number | null>(null);
  useEffect(() => {
    return onRateLimit((ev) => {
      setRateLimitToast(ev);
      if (rateLimitClearTimer.current) window.clearTimeout(rateLimitClearTimer.current);
      rateLimitClearTimer.current = window.setTimeout(() => {
        setRateLimitToast(null);
      }, 12000);
    });
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent font-sans">
      {/* 深空星空背景层（pointer-events-none，z-0） */}
      <Starfield />

      {/* 画布层：按需切换 Cesium 地球 / Three.js 太阳系 */}
      {solarSystemActive ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-0 flex items-center justify-center bg-ink-900 text-sm text-white/60">
              正在加载太阳系视图…
            </div>
          }
        >
          <SolarSystemCanvas />
        </Suspense>
      ) : (
        <>
          <CesiumCanvas onReady={handleCesiumReady} />
          <CesiumLayerSync />
        </>
      )}

      {/* 顶部栏 */}
      <TopBar
        onOpenCommandMenu={() => setCommandMenuOpen(true)}
        onToggleMute={toggleMute}
        onToggleRealtimeChat={toggleRealtimeChat}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* 引导文字 */}
      <Guidance />

      {/* 工具坞 */}
      <ToolDock />

      {/* 字幕层 + 讲义层 */}
      <SubtitleLayer />

      {/* FPS 性能监控（开发模式显示，生产模式按 Alt 显示） */}
      <FpsDisplay />

      {/* 课程命令菜单 */}
      <CommandMenu open={commandMenuOpen} onClose={() => setCommandMenuOpen(false)} />

      {/* 按键说明帮助面板（? 键唤起） */}
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* 移动端麦克风按钮（触摸设备替代 Push-to-Talk） */}
      <button
        onClick={toggleRecording}
        className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-ink-800/80 text-geo-300 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 transition-all md:hidden"
        aria-label="语音"
      >
        <Mic className="h-5 w-5" />
      </button>

      {/* API 限流 / 错误静默期提示（issue #18 Toast） */}
      {rateLimitToast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-[min(92vw,420px)] -translate-x-1/2 rounded-lg bg-amber-500/95 px-4 py-3 text-sm font-medium text-amber-50 ring-1 ring-amber-200/40 shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4"
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 pt-0.5">⚠️</div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">数据服务暂时限流</div>
              <div className="mt-0.5 text-amber-50/90">
                网络请求过于频繁，当前使用本地缓存或默认教学数据。请稍后再试（{rateLimitToast.remainSeconds}s）。
              </div>
              <div className="mt-1 text-xs text-amber-50/70 truncate">
                {rateLimitToast.reason} · {new URL(rateLimitToast.url).host}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LayerLifeCycleManager 错误 Toast：红色底，6s，底部左下角，避免和 rateLimit 冲突 */}
      {layerError && (
        <div
          role="alert"
          data-testid="layer-error-toast"
          className="pointer-events-none fixed bottom-6 left-6 z-40 w-[min(90vw,380px)] rounded-lg bg-rose-700/95 px-4 py-3 text-sm font-medium text-rose-50 ring-1 ring-rose-300/40 shadow-xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4"
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 pt-0.5">⛔</div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">图层切换失败</div>
              <div className="mt-0.5 break-words text-rose-50/95">{layerError.msg}</div>
              <div className="mt-1 text-[11px] text-rose-50/60 tabular-nums">
                {new Date(layerError.at).toLocaleTimeString()} · 已自动回退到上一层
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
