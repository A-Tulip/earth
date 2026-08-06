/**
 * RealtimeVoiceChat —— 实时对话模式（全双工语音交互）
 *
 * 与 PushToTalk（按住空格录音-松开提交）不同，实时对话模式：
 * - 用户随时说话，VAD 自动检测说话开始/结束
 * - 检测到句末（静音段）自动提交 LLM
 * - AI 回复通过 TTS 实时播放
 * - 用户说话时自动打断 TTS（barge-in）
 *
 * 架构（方案 B：基于现有 WebSocket 流式 ASR + VAD）：
 *   麦克风 → AnalyserNode(VAD) + MediaRecorder(StreamingASR)
 *         → 检测句末 → LLM → 工具调用 + TTS 播放
 *
 * 降级链：
 *   1. 流式 ASR (WebSocket /ws/asr) + VAD  ← 主路径
 *   2. 浏览器 Web Speech API (连续模式) + VAD  ← 自动降级
 *   3. PushToTalk 模式  ← 手动降级（关闭实时对话）
 *
 * 火山引擎 RTC（方案 A）升级路径：
 *   预留 /api/rtc/token 端点，未来可接入火山引擎 rtc_conversational_ai
 *   通过 StartVoiceChat API 启动智能体，使用 WebRTC 全双工通信。
 *   当前方案 B 已能满足教学场景需求，且无需引入 RTC SDK。
 */

import { useCallback, useEffect, useRef } from 'react';
import { ASRAdapter, TTSAdapter, LLMAdapter, LLMMessage } from './adapters';
import { commandBus } from '../commands/bus';
import { useGeographyStore } from '../state/store';
import { LESSON_CATALOG } from '../lessons/catalog';

interface RealtimeVoiceChatOptions {
  asr: ASRAdapter;
  tts: TTSAdapter;
  llm: LLMAdapter;
  enabled?: boolean;
}

/** VAD 配置 */
const VAD_CONFIG = {
  energyThreshold: 0.012,   // RMS 能量阈值（安静环境约 0.005，正常说话约 0.02-0.05）
  silenceDurationMs: 800,   // 静音持续时间判定句末
  minSpeechMs: 300,         // 最短说话时长（过滤咳嗽/碰撞噪声）
  pollIntervalMs: 100,      // VAD 检测间隔
};

/** 对话状态机 */
type ChatState = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * 实时对话模式 Hook
 *
 * 启用后：
 * - 持续监听麦克风（VAD 检测）
 * - 检测到说话 → 启动 ASR
 * - 检测到句末 → 提交 LLM → 执行工具 → TTS 播放
 * - TTS 播放时检测到用户说话 → 自动打断
 */
export function useRealtimeVoiceChat({ asr, tts, llm, enabled = false }: RealtimeVoiceChatOptions) {
  const stateRef = useRef<ChatState>('idle');
  const vadAudioContextRef = useRef<AudioContext | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const speechStartRef = useRef<number>(0);
  const lastVoiceRef = useRef<number>(0);
  const asrActiveRef = useRef<boolean>(false);
  const ttsAbortRef = useRef<boolean>(false);
  /** 当前正在进行的 ASR.start() Promise；stop 前先 await，避免"还没启动就被 stop"丢整句 */
  const asrStartPromiseRef = useRef<Promise<void> | null>(null);
  const store = useGeographyStore;
  // ✅ ISSUE-2：实时对话历史累积（同 PushToTalk，最多 20 条消息，课程切换清空）
  const historyRef = useRef<LLMMessage[]>([]);
  const lastLessonIdRef = useRef<string | null>(null);

  /** 历史过长时，删除最老的 user+assistant 对 */
  const trimHistory = useCallback(() => {
    const MAX = 20;
    while (historyRef.current.length > MAX) {
      const firstNonSysIdx = historyRef.current.findIndex((m) => m.role !== 'system');
      if (firstNonSysIdx < 0) {
        historyRef.current.splice(0, 1);
      } else {
        const end = Math.min(firstNonSysIdx + 2, historyRef.current.length);
        historyRef.current.splice(firstNonSysIdx, end - firstNonSysIdx);
      }
    }
  }, []);

  /** 清空对话历史 */
  const clearHistory = useCallback(() => {
    historyRef.current = [];
  }, []);

  /** 设置对话状态（同步 ref 和 UI） */
  const setState = useCallback((next: ChatState) => {
    stateRef.current = next;
    switch (next) {
      case 'idle':
        store.getState().setVoice({
          listening: false,
          processing: false,
          speaking: false,
          asrStreaming: false,
        });
        break;
      case 'listening':
        store.getState().setVoice({
          listening: true,
          processing: false,
          speaking: false,
          asrStreaming: true,
        });
        break;
      case 'processing':
        store.getState().setVoice({
          listening: false,
          processing: true,
          speaking: false,
          asrStreaming: false,
        });
        break;
      case 'speaking':
        store.getState().setVoice({
          listening: false,
          processing: false,
          speaking: true,
        });
        break;
    }
  }, [store]);

  /** 停止 TTS 播放（自动打断） */
  const stopTts = useCallback(() => {
    ttsAbortRef.current = true;
    tts.stop();
  }, [tts]);

  /** 启动 ASR 识别 */
  const startAsr = useCallback(async () => {
    if (asrActiveRef.current) return;
    asrActiveRef.current = true;
    try {
      store.getState().setVoice({
        transcript: '',
        partialText: '',
        error: null,
      });
      asr.setOnPartial?.((text: string) => {
        store.getState().setVoice({ partialText: text });
      });
      // 记录本次启动的 Promise：VAD 检测到句末时会先 await 它，确保麦克风真正就绪
      // 之后再 stop()，避免"start() 还没完成（health 探测/麦克风就绪）就被 stop() 返回空"丢整句。
      const p = asr.start();
      asrStartPromiseRef.current = p;
      await p;
    } catch (err) {
      asrActiveRef.current = false;
      asrStartPromiseRef.current = null;
      const message = err instanceof Error ? err.message : 'ASR 启动失败';
      store.getState().setVoice({
        error: `实时对话 ASR 失败：${message}。可切换到按住空格模式。`,
      });
      setState('idle');
    }
  }, [asr, store, setState]);

  /** 停止 ASR 并获取识别结果 */
  const stopAsrAndGetText = useCallback(async (): Promise<string> => {
    if (!asrActiveRef.current) return '';
    asrActiveRef.current = false;
    try {
      // 关键：先等 start() 真正完成（麦克风已启动），再 stop()。
      // 否则 VAD 瞬间判定句末、start() 还在 await 时 stop() 会返回空文本。
      if (asrStartPromiseRef.current) {
        await asrStartPromiseRef.current;
        asrStartPromiseRef.current = null;
      }
      const result = await asr.stop();
      return result.text.trim();
    } catch {
      return '';
    }
  }, [asr]);

  /** 提交 LLM 并执行工具调用 + TTS 播放 */
  const submitToLlm = useCallback(async (userText: string) => {
    if (!userText) {
      setState('idle');
      return;
    }

    setState('processing');
    store.getState().setVoice({ transcript: userText, partialText: '' });

    try {
      // ✅ ISSUE-2：拼接上下文
      const s = store.getState();
      const sceneContext: string[] = [];
      // 课程上下文
      if (s.lesson.activeLessonId) {
        const meta = LESSON_CATALOG.find((c) => c.id === s.lesson.activeLessonId);
        if (meta) {
          const levelStr = meta.level === 'junior' ? '初中' : '高中';
          const categoryMap: Record<string, string> = {
            natural: '自然地理',
            human: '人文地理',
            regional: '区域地理',
            'earth-map': '地球与地图',
          };
          const categoryStr = categoryMap[meta.category] ?? meta.category;
          sceneContext.push(`正在上课：${meta.title}（${meta.grade} ${levelStr} · ${categoryStr}）`);
        }
        sceneContext.push(`当前步骤 ${s.lesson.currentStep + 1}/${s.lesson.totalSteps}：${s.lesson.stepTitle || '未命名步骤'}`);
      }
      // 镜头 / 选中对象
      const cam = s.camera;
      sceneContext.push(`镜头坐标：经度 ${cam.longitude.toFixed(1)}°，纬度 ${cam.latitude.toFixed(1)}°，高度 ${Math.round(cam.height)}m`);
      if (s.selected?.name) sceneContext.push(`选中对象：${s.selected.kind}「${s.selected.name}」`);
      // 图层
      const activeLayers: string[] = [];
      for (const [k, v] of Object.entries(s.annotations)) if (v === true) activeLayers.push(k);
      for (const [k, v] of Object.entries(s.astronomy)) if (v === true) activeLayers.push(k);
      for (const [k, v] of Object.entries(s.data)) if (v === true) activeLayers.push(k);
      if (activeLayers.length) sceneContext.push(`已开图层：${activeLayers.join('、')}`);
      sceneContext.push(`视图模式：${s.viewMode}，底图：${s.basemap}`);
      // 地形分析
      const terrain = s.terrain;
      if (terrain.contour) sceneContext.push(`分析层：等高线（间距 ${terrain.contourSpacing}m）`);
      else if (terrain.elevationRamp) sceneContext.push(`分析层：高程分层设色`);
      else if (terrain.slope) sceneContext.push(`分析层：坡度图`);
      else if (terrain.aspect) sceneContext.push(`分析层：坡向图`);
      if (terrain.exaggeration !== 1) sceneContext.push(`地形夸张：${terrain.exaggeration}×`);

      const systemPrompt = `你是初高中地理 AI 教学助手（"地理画布"平台）。请用简洁、准确、符合课标的中文回答学生。
角色规则：
- 你能看到当前地球画布的状态（镜头、图层、课程进度），作为回答上下文。
- 当学生指令可通过地理工具完成时（等高线、图层切换、飞行定位、二维三维切换、地形夸张、课程控制、测量标注、动画控制等），使用 toolCalls 返回；否则直接用 text 回答。
- 可用工具清单：等高线、高程分层、坡度、坡向、地形夸张、二维三维切换、底图切换、飞行定位、图层开关（osm/卫星/天地图矢量/国家基础地理信息中心影像/高德卫星/EsriOcean/地形/国界/地震/天气/GDP/人口/气温/降水/城市/板块/水系/经纬网）、课程打开、课程下一步/上一步、动画播放/暂停/重置、问题出题、解释概念、测量、标注、太阳系切换、截图。
- 回答不能编造虚假地理数据；不确定的给出边界并建议学生查阅对应课标章节。
${sceneContext.length ? `\n【当前画布上下文】\n${sceneContext.join('\n')}` : ''}
${historyRef.current.length ? `\n【已进行 ${Math.floor(historyRef.current.length / 2)} 轮对话，学生可能会追问上一轮问题】` : ''}`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyRef.current,
        { role: 'user', content: userText },
      ];

      const response = await llm.chat(messages);

      // ✅ ISSUE-2：累积历史
      historyRef.current.push({ role: 'user', content: userText });
      historyRef.current.push({
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls,
      });
      trimHistory();

      // 执行工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const call of response.toolCalls) {
          try {
            await commandBus.execute({ name: call.name as never, args: call.args });
          } catch {
            // 单个工具失败不中断整体流程
          }
        }
      }

      // TTS 朗读回复
      if (response.text && !store.getState().voice.muted) {
        setState('speaking');
        ttsAbortRef.current = false;
        store.getState().setVoice({ response: response.text, speaking: true });
        await tts.speak(response.text);
        // 检查是否被用户打断
        if (!ttsAbortRef.current) {
          store.getState().setVoice({ speaking: false });
        }
      }

      setState('idle');
    } catch (err) {
      store.getState().setVoice({
        error: err instanceof Error ? err.message : 'LLM 处理失败',
      });
      setState('idle');
    }
  }, [llm, tts, store, setState, trimHistory]);

  /** VAD 检测：计算 RMS 音量 */
  const computeRms = useCallback((): number => {
    const analyser = vadAnalyserRef.current;
    if (!analyser) return 0;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buffer.length);
  }, []);

  /** VAD 主循环：检测说话开始/结束 */
  const vadLoop = useCallback(() => {
    const now = Date.now();
    const rms = computeRms();
    const state = stateRef.current;

    // 检测到语音能量
    if (rms > VAD_CONFIG.energyThreshold) {
      lastVoiceRef.current = now;

      // 空闲或播放中 → 检测到用户说话，启动 ASR（自动打断 TTS）
      if (state === 'idle') {
        if (speechStartRef.current === 0) {
          speechStartRef.current = now;
        }
        // 持续说话超过 minSpeechMs 才确认是有效语音（过滤噪声）
        if (now - speechStartRef.current >= VAD_CONFIG.minSpeechMs) {
          void startAsr();
          setState('listening');
        }
      } else if (state === 'speaking') {
        // 自动打断：TTS 播放中检测到用户说话
        stopTts();
        if (speechStartRef.current === 0) {
          speechStartRef.current = now;
        }
        if (now - speechStartRef.current >= VAD_CONFIG.minSpeechMs) {
          void startAsr();
          setState('listening');
        }
      }
    } else {
      // 静音段
      if (state === 'listening') {
        // 检测句末：静音超过 silenceDurationMs
        const silenceMs = now - lastVoiceRef.current;
        if (lastVoiceRef.current > 0 && silenceMs >= VAD_CONFIG.silenceDurationMs) {
          // 句末确认，提交 LLM
          speechStartRef.current = 0;
          void stopAsrAndGetText().then((text) => {
            void submitToLlm(text);
          });
        }
      } else if (state === 'idle' || state === 'speaking') {
        speechStartRef.current = 0;
      }
    }
  }, [computeRms, startAsr, stopAsrAndGetText, stopTts, submitToLlm, setState]);

  /** 启动 VAD 监听 */
  const startVad = useCallback(async () => {
    if (vadIntervalRef.current !== null) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vadStreamRef.current = stream;
      vadAudioContextRef.current = new AudioContext();
      const source = vadAudioContextRef.current.createMediaStreamSource(stream);
      const analyser = vadAudioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      vadAnalyserRef.current = analyser;

      setState('idle');
      vadIntervalRef.current = window.setInterval(vadLoop, VAD_CONFIG.pollIntervalMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : '麦克风权限失败';
      store.getState().setVoice({
        error: `实时对话启动失败：${message}。可使用按住空格模式。`,
        realtimeChatActive: false,
      });
    }
  }, [vadLoop, setState, store]);

  /** 停止 VAD 监听 */
  const stopVad = useCallback(() => {
    if (vadIntervalRef.current !== null) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    vadAnalyserRef.current = null;
    if (vadAudioContextRef.current) {
      void vadAudioContextRef.current.close();
      vadAudioContextRef.current = null;
    }
    if (vadStreamRef.current) {
      vadStreamRef.current.getTracks().forEach((t) => t.stop());
      vadStreamRef.current = null;
    }
    asrActiveRef.current = false;
    speechStartRef.current = 0;
    lastVoiceRef.current = 0;
    setState('idle');
  }, [setState]);

  /** 启用/禁用实时对话模式 */
  useEffect(() => {
    if (enabled) {
      void startVad();
    } else {
      stopVad();
      asr.abort();
      tts.stop();
    }
    return () => {
      stopVad();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  /** 课程切换时清空对话历史 */
  useEffect(() => {
    return store.subscribe(
      (s) => s.lesson.activeLessonId,
      (newId) => {
        if (newId !== lastLessonIdRef.current) {
          clearHistory();
          lastLessonIdRef.current = newId;
        }
      },
      { fireImmediately: true },
    );
  }, [store, clearHistory]);

  /** 切换实时对话模式 */
  const toggleRealtimeChat = useCallback(() => {
    const active = store.getState().voice.realtimeChatActive;
    store.getState().setVoice({ realtimeChatActive: !active, error: null });
  }, [store]);

  return { toggleRealtimeChat, clearHistory };
}
