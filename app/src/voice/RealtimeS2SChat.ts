/**
 * RealtimeS2SChat —— 端到端实时语音对话（Realtime S2S，单连接完成 ASR+LLM+TTS）
 *
 * 与三段式 RealtimeVoiceChat（麦克风→ASR→LLM→TTS）不同，本模块走火山端到端实时语音大模型：
 *   麦克风(16k PCM) --上传--> /ws/s2s --> 火山(识别+理解+合成) --> TTS音频 --播放--> 扬声器
 *
 * 服务端 VAD：客户端持续上传 16k PCM，服务端自动检测用户说话开始/结束，并将答案以 TTS 音频返回。
 * 前端职责：采集麦克风 → 降采样到 16k int16 → 上传；接收 TTS 音频 → 排队播放；维护倾听/处理/播报状态。
 *
 * 降级：若 S2S 连接失败，调用方应回退到三段式 RealtimeVoiceChat 或空格键单击模式。
 */

import { useCallback, useEffect, useRef } from 'react';
import { S2SAdapter } from './adapters';
import { useGeographyStore } from '../state/store';

interface RealtimeS2SChatOptions {
  adapter: S2SAdapter;
  enabled?: boolean;
}

/** 对话状态机（与三段式保持一致，便于 UI 复用） */
type ChatState = 'idle' | 'listening' | 'processing' | 'speaking';

/** Float32 → int16 小端序 PCM */
function floatToPcm16LE(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** 线性插值降采样器（inputRate → outputRate，这里是 →16000） */
class LinearResampler {
  private ratio: number;
  private last = 0;
  private pos = 0;
  constructor(inputRate: number, outputRate: number) {
    this.ratio = inputRate / outputRate;
  }
  process(input: Float32Array): Float32Array {
    const outLen = Math.max(0, Math.ceil((input.length - this.pos) / this.ratio));
    const out = new Float32Array(outLen);
    let oi = 0;
    let i = this.pos;
    while (i < input.length && oi < outLen) {
      const i0 = Math.floor(i);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = i - i0;
      const s0 = i0 >= 0 ? input[i0] : this.last;
      out[oi++] = s0 + (input[i1] - s0) * frac;
      i += this.ratio;
    }
    this.pos = i - input.length;
    this.last = input[input.length - 1] ?? 0;
    return out;
  }
  reset(): void {
    this.pos = 0;
    this.last = 0;
  }
}

/** TTS 音频（PCM16 24000Hz 单声道）顺序播放 */
class PcmPlayer {
  private ctx: AudioContext | null = null;
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private stopped = false;

  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        // 生产浏览器 autoplay 策略：非用户手势内创建的 AudioContext 初始为 suspended，
        // 不 resume 则 createBufferSource().start() 不发声。TTS 帧到达时已是异步回调，
        // 这里在创建时立即尝试 resume（点击按钮的 transient activation 窗口内通常可成功）。
        if (this.ctx.state === 'suspended') {
          void this.ctx.resume().catch(() => undefined);
        }
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  enqueue(data: ArrayBuffer): void {
    if (this.stopped) return;
    this.queue.push(data);
    if (!this.playing) this.playNext();
  }

  private playNext(): void {
    if (this.stopped) return;
    const ctx = this.ensureCtx();
    if (!ctx || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.playing = true;
    const int16 = new Int16Array(item);
    const frames = int16.length;
    const buffer = ctx.createBuffer(1, frames, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) ch[i] = int16[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      this.playing = false;
      this.playNext();
    };
    src.start();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

/**
 * 端到端实时语音对话 Hook
 *
 * 启用后：
 * - 连接 /ws/s2s 并 StartSession（配置地理教学人设 + O2.0 模型 + 音色）
 * - 持续采集麦克风 → 16k PCM → 上传（服务端 VAD 自动判句末）
 * - 接收 TTS 音频顺序播放，维护倾听/处理/播报状态
 */
export function useRealtimeS2SChat({ adapter, enabled = false }: RealtimeS2SChatOptions) {
  const store = useGeographyStore;
  const stateRef = useRef<ChatState>('idle');
  const captureCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const resamplerRef = useRef<LinearResampler | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const sessionReadyRef = useRef(false);

  const setState = useCallback(
    (next: ChatState) => {
      stateRef.current = next;
      switch (next) {
        case 'idle':
          store.getState().setVoice({ listening: false, processing: false, speaking: false });
          break;
        case 'listening':
          store.getState().setVoice({ listening: true, processing: false, speaking: false });
          break;
        case 'processing':
          store.getState().setVoice({ listening: false, processing: true, speaking: false });
          break;
        case 'speaking':
          store.getState().setVoice({ listening: false, processing: false, speaking: true });
          break;
      }
    },
    [store],
  );

  const stopCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch (e) { console.warn('[EmptyCatch] voice/RealtimeS2SChat.ts:168', (e as any)?.message ?? e); }
      processorRef.current = null;
    }
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) { console.warn('[EmptyCatch] voice/RealtimeS2SChat.ts:176', (e as any)?.message ?? e); }
      micSourceRef.current = null;
    }
    if (captureCtxRef.current) {
      void captureCtxRef.current.close().catch(() => undefined);
      captureCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    resamplerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopCapture();
    try {
      adapter.finishSession();
    } catch (e) { console.warn('[EmptyCatch] voice/RealtimeS2SChat.ts:196', (e as any)?.message ?? e); } finally {
      sessionReadyRef.current = false;
    }
    playerRef.current?.stop();
    playerRef.current = null;
    setState('idle');
  }, [adapter, stopCapture, setState]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // 1. 连接 + 启动会话
        await adapter.connect();
        if (cancelled) return;
        await adapter.startSession();
        sessionReadyRef.current = true;

        // 2. 采集麦克风
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const captureCtx = new AudioContext();
        captureCtxRef.current = captureCtx;
        // 生产 browser autoplay：非用户手势(async 效果体+WS 握手后)创建的 AudioContext 初始 suspended，
        // 不 resume 则 ScriptProcessor 的 onaudioprocess 永不触发 → 麦克风静音、无对话响应。
        // 按钮点击的 transient activation 窗口内 resume 通常可成功。
        if (captureCtx.state === 'suspended') {
          await captureCtx.resume().catch(() => undefined);
        }
        const source = captureCtx.createMediaStreamSource(stream);
        micSourceRef.current = source;
        // ⚠️ ScriptProcessorNode 必须显式声明输出通道（≥1）才能 connect(destination)，
        //   否则浏览器抛 "cannot connect a ScriptProcessorNode with 0 output channels to any destination node"。
        //   输出通道实际不产生声音（onaudioprocess 里我们 echo 输入到输出，但输出端不接扬声器）。
        const processor = captureCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        resamplerRef.current = new LinearResampler(captureCtx.sampleRate, 16000);

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer.getChannelData(0);
          const resampled = resamplerRef.current?.process(input) ?? input;
          if (resampled.length > 0) {
            adapter.sendAudio(floatToPcm16LE(resampled));
          }
          // 仅用于驱动 onaudioprocess（不接 destination.destination，不产生扬声器声音）
        };
        source.connect(processor);
        processor.connect(captureCtx.destination); // 1 输出通道，用于驱动 onaudioprocess

        // 3. 播放器
        playerRef.current = new PcmPlayer();
        setState('idle');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'S2S 启动失败';
        store.getState().setVoice({
          error: `实时对话启动失败：${message}。可用空格键单击模式。`,
          realtimeChatActive: false,
        });
        stopCapture();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // 事件回调绑定（adapter 支持动态 setCallbacks）
  useEffect(() => {
    const onASR = (text: string, isInterim: boolean) => {
      if (isInterim) {
        store.getState().setVoice({ partialText: text });
        setState('listening');
      } else {
        store.getState().setVoice({ transcript: text, partialText: '' });
      }
    };
    const onASREnded = () => setState('processing');
    const onChat = (text: string) => store.getState().setVoice({ response: text });
    const onTTSAudio = (data: ArrayBuffer) => {
      setState('speaking');
      playerRef.current?.enqueue(data);
    };
    const onTTSEnded = () => setState('idle');
    const onErr = (code: string, message: string) => {
      store.getState().setVoice({ error: `实时对话错误(${code})：${message}` });
    };
    adapter.setCallbacks({
      onASRResponse: onASR,
      onASREnded,
      onChatResponse: onChat,
      onTTSAudio,
      onTTSEnded,
      onError: onErr,
      onSessionStarted: () => setState('idle'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  /** 切换实时对话模式 */
  const toggleRealtimeChat = useCallback(() => {
    const active = store.getState().voice.realtimeChatActive;
    store.getState().setVoice({ realtimeChatActive: !active, error: null });
  }, [store]);

  return { toggleRealtimeChat };
}