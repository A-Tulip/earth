/**
 * App —— 应用根组件
 *
 * AI 地理画布：
 * - 打开即看到完整地球
 * - 无登录、无欢迎流程、无 API 配置
 * - 按住空格语音、工具坞手动操作
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { CesiumCanvas } from './cesium/CesiumCanvas';
import { CesiumLayerSync } from './cesium/CesiumLayerSync';
import { CesiumController } from './cesium/controller';
import { TopBar } from './ui/TopBar';
import { ToolDock } from './ui/ToolDock';
import { CommandMenu } from './ui/CommandMenu';
import { SubtitleLayer } from './ui/SubtitleLayer';
import { Guidance } from './ui/Guidance';
import { HelpPanel } from './ui/HelpPanel';
import { isEditable } from './voice/PushToTalk';
import { Mic } from './ui/icons';
import { usePushToTalk } from './voice/PushToTalk';
import { useRealtimeVoiceChat } from './voice/RealtimeVoiceChat';
import { createASRAdapter, createTTSAdapter, createLLMAdapter } from './voice/adapters';
import { LessonRuntime } from './lessons/runtime';
import { commandBus } from './commands/bus';
import { useGeographyStore } from './state/store';

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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ink-900 font-sans">
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
    </div>
  );
}
