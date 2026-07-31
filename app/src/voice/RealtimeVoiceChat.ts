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
  const store = useGeographyStore;

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
      await asr.start();
    } catch (err) {
      asrActiveRef.current = false;
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
      const systemPrompt = `你是地理教学助手。根据用户的语音指令，调用相应的地理工具。
可用工具：等高线、高程分层、坡度、坡向、地形夸张、二维三维切换、底图切换、飞行定位、图层开关、课程打开、动画播放暂停、太阳系切换、截图、测量。
用户指令：${userText}`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ];

      const response = await llm.chat(messages);

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
  }, [llm, tts, store, setState]);

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

  /** 切换实时对话模式 */
  const toggleRealtimeChat = useCallback(() => {
    const active = store.getState().voice.realtimeChatActive;
    store.getState().setVoice({ realtimeChatActive: !active, error: null });
  }, [store]);

  return { toggleRealtimeChat };
}
