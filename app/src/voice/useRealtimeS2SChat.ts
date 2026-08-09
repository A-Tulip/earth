/**
 * useRealtimeS2SChat —— 豆包端到端实时语音（RealtimeAPI）全双工对话 Hook
 *
 * 作为实时对话模式的可选全双工路径：启用时建立 S2S 会话并持续采集麦克风，
 * 火山端自动判停并返回 TTS 音频，天然支持打断。
 *
 * 降级：S2S 连接/启动失败时抛错，由调用方（App.tsx）切回三段式实时对话。
 */
import { useCallback, useEffect, useRef } from 'react';
import { RealtimeS2SChat, S2SUnavailableError } from './RealtimeS2SChat';
import { useGeographyStore } from '../state/store';

export interface UseRealtimeS2SChatOptions {
  enabled?: boolean;
  systemRole?: string;
  pcmOutput?: boolean;
  endSmoothWindowMs?: number;
}

export function useRealtimeS2SChat({ enabled = false, systemRole, pcmOutput = true, endSmoothWindowMs = 1500 }: UseRealtimeS2SChatOptions) {
  const clientRef = useRef<RealtimeS2SChat | null>(null);
  const micStopRef = useRef<{ stop(): Promise<void> } | null>(null);
  const store = useGeographyStore;

  // 创建客户端（懒加载，单例）
  const getClient = useCallback(() => {
    if (clientRef.current) return clientRef.current;
    const setVoice = (partial: {
      listening?: boolean;
      processing?: boolean;
      speaking?: boolean;
      asrStreaming?: boolean;
      transcript?: string;
      partialText?: string;
      response?: string;
      error?: string | null;
    }) => store.getState().setVoice(partial as never);
    const client = new RealtimeS2SChat({
      systemRole,
      pcmOutput,
      endSmoothWindowMs,
      setVoice,
      callbacks: {
        onTranscript: (text) => {
          store.getState().setVoice({ transcript: text, partialText: '' });
        },
        onReply: (text) => {
          store.getState().setVoice({ response: text });
        },
        onError: (message) => {
          store.getState().setVoice({ error: `实时对话(全双工)错误：${message}` });
        },
        onSpeakingChange: (speaking) => {
          store.getState().setVoice({ speaking });
        },
      },
    });
    clientRef.current = client;
    return client;
  }, [store, systemRole, pcmOutput, endSmoothWindowMs]);

  /** 启动全双工会话 */
  const start = useCallback(async (): Promise<void> => {
    const client = getClient();
    // 失败时抛出 S2SUnavailableError，让调用方降级到三段式
    await client.start();
    const mic = await client.startMic();
    micStopRef.current = mic;
    store.getState().setVoice({ realtimeChatActive: true, s2sActive: true, error: null });
  }, [getClient, store]);

  /** 停止全双工会话 */
  const stop = useCallback(async () => {
    if (micStopRef.current) {
      await micStopRef.current.stop().catch(() => undefined);
      micStopRef.current = null;
    }
    if (clientRef.current) {
      await clientRef.current.stop().catch(() => undefined);
    }
    store.getState().setVoice({ realtimeChatActive: false, s2sActive: false });
  }, [store]);

  /** 切换实时对话模式（全双工优先，失败抛错） */
  const toggleRealtimeChat = useCallback(async (): Promise<void> => {
    const active = store.getState().voice.realtimeChatActive;
    if (active) {
      await stop();
    } else {
      await start();
    }
  }, [store, start, stop]);

  // 组件卸载 / enabled 变化时清理
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { start, stop, toggleRealtimeChat, getClient, S2SUnavailableError };
}