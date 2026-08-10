/**
 * App —— 应用根组件
 *
 * AI 地理画布：
 * - 打开即看到完整地球
 * - 无登录、无欢迎流程、无 API 配置
 * - 空格键单击录音、工具坞手动操作
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from 'react';
import { CesiumCanvas } from './cesium/CesiumCanvas';
import { CesiumLayerSync } from './cesium/CesiumLayerSync';
import { CesiumController } from './cesium/controller';
import { TopBar } from './ui/TopBar';
import { ToolDock } from './ui/ToolDock';
import { CommandMenu } from './ui/CommandMenu';
import { SubtitleLayer } from './ui/SubtitleLayer';
import { LessonPlayer } from './ui/LessonPlayer';
import { Starfield } from './ui/Starfield';

import { FpsDisplay } from './ui/FpsDisplay';
import { LoadingOverlay } from './ui/LoadingOverlay';
import { AppLoader } from './ui/AppLoader';
import { HelpPanel } from './ui/HelpPanel';
import { LayerErrorModal } from './ui/LayerErrorModal';
import { AIChatPanel } from './ui/AIChatPanel';
import { isEditable } from './voice/PushToTalk';
import { Mic } from './ui/icons';
import { usePushToTalk } from './voice/PushToTalk';
import { useRealtimeVoiceChat } from './voice/RealtimeVoiceChat';
import { useRealtimeS2SChat } from './voice/useRealtimeS2SChat';
import { S2SUnavailableError } from './voice/RealtimeS2SChat';
import { createASRAdapter, createTTSAdapter, createLLMAdapter } from './voice/adapters';
import { LessonRuntime } from './lessons/runtime';
import { LESSON_CATALOG } from './lessons/catalog';
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
  const aiChatOpen = useGeographyStore((s) => s.ui.showAIChat);

  // 暴露 store setState 到 window（仅开发调试 + E2E 测试使用，不依赖此做功能使用）
  useEffect(() => {
    const w = window as unknown as {
      _geographyStoreDebug?: {
        setState: typeof useGeographyStore.setState;
        getState: typeof useGeographyStore.getState;
      };
    };
    w._geographyStoreDebug = { setState: (p) => useGeographyStore.setState(p), getState: () => useGeographyStore.getState() };
  }, []);

  // 全局快捷键：
  //   Cmd+K / Ctrl+K → 命令菜单（通用开发入口）
  //   ? 键 → 帮助面板（Shift+/，输入框内不触发）
  //   Ctrl+/ / Cmd+/ → 切换 AI 对话面板（含中文输入法下的？键）
  //   Esc → 关闭当前打开的浮层（AI 面板 / 命令菜单 / 帮助 / 讲义 / 错误弹窗）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdOrCtrl = e.metaKey || e.ctrlKey;

      // ---- Cmd+K / Ctrl+K ----
      if (cmdOrCtrl && (e.key === 'k' || e.key === 'K')) {
        if (isEditable(e.target)) {
          return;
        }
        e.preventDefault();
        setCommandMenuOpen((v) => !v);
        return;
      }

      // ---- Ctrl+/ / Cmd+/ 切换 AI 对话面板 ----
      // e.key 在多数键盘为 '/'，某些布局为 '?'；中文输入法下按下 ? 键（Shift+/）keyCode=191 也能命中
      // ⚠️ 注意：无论 e.target 是不是输入框（textarea/input）都要响应！
      //   之前的 Bug：面板自动 focus 到 textarea 后，isEditable 判断导致快捷键"看起来不能用"
      //   实际上 Ctrl+/ 在普通聊天输入框里没有编辑器注释语义，用做开关面板快捷键是安全的。
      if (cmdOrCtrl && (e.key === '/' || e.key === '？' || e.key === '?' || (e as unknown as { keyCode?: number }).keyCode === 191)) {
        e.preventDefault();
        void commandBus.execute({ name: 'aiChat.toggle', args: {} });
        return;
      }

      // ---- Esc 关闭当前浮层（按优先级：命令菜单 / 帮助 / AI 面板）----
      if (e.key === 'Escape') {
        if (commandMenuOpen) {
          e.preventDefault();
          setCommandMenuOpen(false);
          return;
        }
        if (helpOpen) {
          e.preventDefault();
          setHelpOpen(false);
          return;
        }
        // 唯一的 Esc 处理器：AIChatPanel 不再独立监听 window keydown
        // 无论焦点是否在输入框，Esc 都关面板（桌面 UX 习惯：Esc=取消当前浮层）
        const s = store.getState();
        if (s.ui.showAIChat) {
          e.preventDefault();
          void commandBus.execute({ name: 'aiChat.close', args: {} });
        }
        return;
      }

      // ---- ? 键唤起帮助面板（Shift+/，避免在输入框中触发）----
      if (e.key !== '?') return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey, /* ⚠️ 捕获阶段 true：必须在 Cesium canvas 消费事件之前命中，
      否则 Cesium 的 screenSpaceCameraController 默认 stopPropagation 会导致 window 冒泡阶段收不到
      快捷键（这就是用户说"快捷键依旧不能用"的根因） */ true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandMenuOpen, helpOpen]);

  // 创建语音适配器（单例）
  const asrRef = useRef(createASRAdapter());
  const ttsRef = useRef(createTTSAdapter());
  const llmRef = useRef(createLLMAdapter());

  // 调试：暴露 asr 适配器到 window
  useEffect(() => {
    (window as unknown as { _asrDebug?: unknown })._asrDebug = asrRef.current;
  }, []);

  // 实时对话模式状态（启用时禁用 Push-to-Talk）
  const realtimeChatActive = useGeographyStore((s) => s.voice.realtimeChatActive);
  const s2sActive = useGeographyStore((s) => s.voice.s2sActive);

  // 全双工 S2S（端到端实时语音，优先）。enabled 由 realtimeChatActive 驱动，停止/卸载时自动清理。
  const s2s = useRealtimeS2SChat({
    enabled: realtimeChatActive,
    endSmoothWindowMs: 800,
  });

  // Push-to-Talk（实时对话模式启用时禁用）
  const { toggleRecording, interrupt } = usePushToTalk({
    asr: asrRef.current,
    tts: ttsRef.current,
    llm: llmRef.current,
    enabled: !realtimeChatActive,
  });

  // 三段式实时对话（ASR→LLM工具调用→commandBus操控地球→TTS，支持打断）
  // 仅作为 S2S 不可用时的回退路径：s2sActive 为真时不启动 VAD，避免双通道冲突。
  useRealtimeVoiceChat({
    asr: asrRef.current,
    tts: ttsRef.current,
    llm: llmRef.current,
    enabled: realtimeChatActive && !s2sActive,
  });

  // 组合开关：优先全双工 S2S，失败自动回退三段式
  const handleToggleRealtimeChat = useCallback(async () => {
    console.debug('[S2S] handleToggleRealtimeChat invoked, active=', store.getState().voice.realtimeChatActive);
    const active = store.getState().voice.realtimeChatActive;
    if (active) {
      // 关闭：三段式经 enabled 副作用 teardown，S2S 经其 enabled 清理 teardown
      store.getState().setVoice({ realtimeChatActive: false, s2sActive: false });
      return;
    }
    // 开启：先试全双工 S2S
    try {
      await s2s.start(); // 成功时内部置 realtimeChatActive=true, s2sActive=true
    } catch (err) {
      if (err instanceof S2SUnavailableError) {
        // S2S 不可用 → 回退三段式（enabled 副作用会启动 VAD）
        store.getState().setVoice({
          realtimeChatActive: true,
          s2sActive: false,
          error: '端到端实时语音暂不可用，已切换到基础实时对话。',
        });
      } else {
        store.getState().setVoice({
          error: `实时对话启动失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, [store, s2s]);

  // Cesium 就绪回调（命令处理器由 CesiumCanvas 内部注册一次）
  const handleCesiumReady = useCallback((controller: CesiumController) => {
    commandBus.setContext({ cesium: controller });

    // 创建课程运行时
    const runtime = new LessonRuntime();
    // ✅ ISSUE-6：把 LLM 适配器注入 LessonRuntime
    //   - 使 step.aiPrompt（无 narration 文案）的课程能动态生成旁白
    //   - 暴露 askAI() 方法供学生随时提问当前课程内容
    runtime.setLLMAdapter(llmRef.current);
    lessonRuntimeRef.current = runtime;
    commandBus.setContext({ lesson: runtime });

    setControllerReady(true);

    // Q7：CesiumController 就绪后（通常 200-600ms），后台"低优先级预热"前 4 门热门课程的 chunk import，
    //     让用户第一次点开等高线/自转/阶梯/公转不用等 import。不 await，失败静默。
    const hotIds = LESSON_CATALOG.slice(0, 4).map((x) => x.id);
    for (const id of hotIds) {
      window.setTimeout(() => LessonRuntime.warmUpLesson(id), 1200 + Math.random() * 800);
    }
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
  // ⚠️ 必须先更新 prevListeningRef 再调用 interrupt()：
  //   interrupt() → pause() → setLesson({isPaused:true}) 会同步重入本订阅者。
  //   若把 ref 赋值放在 interrupt() 之后，重入时 ref 仍为 false，会无限递归 → "Maximum call stack size exceeded"，
  //   导致空格键唤起语音后立即崩溃、语音无法正常使用。
  const prevListeningRef = useRef(false);
  useEffect(() => {
    const unsubscribe = store.subscribe((state) => {
      const nowListening = state.voice.listening;
      const wasListening = prevListeningRef.current;
      prevListeningRef.current = nowListening;
      if (nowListening && !wasListening && lessonRuntimeRef.current) {
        lessonRuntimeRef.current.interrupt();
      }
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
      {/* ⚠️ AppLoader 必须是第一个 DOM 子节点：挡住下面所有内容直到 startupProgress=100%，
          避免首帧暴露"星空已就绪 + 地球蓝色椭球 + TopBar 一块一块出来"的拼装感 */}
      <AppLoader />

      {/* 深空星空背景层（pointer-events-none，最底层 z-[-1]） */}
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
        onToggleRealtimeChat={handleToggleRealtimeChat}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* 工具坞 */}
      <ToolDock />

      {/* Q2 图层/模式加载遮罩：在 basemap/terrain/sceneMode 切换时防止蓝色裸露 */}
      <LoadingOverlay />

      {/* 字幕层 + 讲义层 */}
      <SubtitleLayer />

      {/* 课程播放控制条 + 问题答题卡 */}
      <LessonPlayer />

      {/* FPS 性能监控（开发模式显示，生产模式按 Alt 显示） */}
      <FpsDisplay />

      {/* 课程命令菜单 */}
      <CommandMenu open={commandMenuOpen} onClose={() => setCommandMenuOpen(false)} />

      {/* 按键说明帮助面板（? 键唤起） */}
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Q1：图层加载失败的居中模态提示（含错误分类+重试+关闭按钮） */}
      <LayerErrorModal />

      {/* Q9：AI 对话面板（右下角可折叠，关闭时显示悬浮球） */}
      <AIChatPanel />

      {/* 移动端麦克风按钮（触摸设备替代 Push-to-Talk）：AI 对话打开时移到左下角，避免与悬浮球重叠 */}
      {!aiChatOpen ? (
        <button
          onClick={toggleRecording}
          className="fixed bottom-6 right-20 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-ink-800/80 text-geo-300 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 transition-all md:hidden"
          aria-label="语音"
        >
          <Mic className="h-5 w-5" />
        </button>
      ) : (
        <button
          onClick={toggleRecording}
          className="fixed bottom-6 left-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-ink-800/80 text-geo-300 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 transition-all md:hidden"
          aria-label="语音"
        >
          <Mic className="h-5 w-5" />
        </button>
      )}

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

      {/* LayerLifeCycleManager 错误提示统一走 LayerErrorModal（居中大弹窗，有关闭+重试），
          不再额外显示左下角 Toast，避免同一个错误同时弹两次造成困扰。 */}
    </div>
  );
}
