/**
 * PushToTalk —— 按住空格录音、松开提交的语音控制
 *
 * 安全处理：
 * - event.repeat 防止重复触发
 * - 输入框/文本域/contenteditable 中空格正常输入
 * - 窗口失焦/页面隐藏时安全结束录音
 * - 语音权限拒绝时提供文本命令入口
 */

import { useEffect, useCallback, useRef } from 'react';
import { ASRAdapter, TTSAdapter, LLMAdapter, LLMMessage } from './adapters';
import { commandBus } from '../commands/bus';
import { useGeographyStore } from '../state/store';

interface PushToTalkOptions {
  asr: ASRAdapter;
  tts: TTSAdapter;
  llm: LLMAdapter;
  enabled?: boolean;
}

/** 判断元素是否可编辑（空格应正常输入） */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // isContentEditable 在某些环境（如 jsdom）不一定反映 attribute，叠加 attribute 检查更稳健
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  return attr === 'true' || attr === '';
}

export function usePushToTalk({ asr, tts, llm, enabled = true }: PushToTalkOptions) {
  const isRecordingRef = useRef(false);
  const store = useGeographyStore;

  /** 开始录音 */
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return; // 防重复
    if (asr.isListening()) return;

    try {
      store.getState().setVoice({ listening: true, error: null, transcript: '', partialText: '' });
      // 绑定 partial 回调 —— 用户说话时实时更新 partial 文本
      asr.setOnPartial?.((text: string) => {
        store.getState().setVoice({ partialText: text });
      });
      await asr.start();
      store.getState().setVoice({ asrStreaming: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '录音启动失败';
      store.getState().setVoice({
        listening: false,
        asrStreaming: false,
        error: `语音权限失败：${message}。可使用文本输入或工具坞操作。`,
      });
    }
  }, [asr, store]);

  /** 停止录音并处理 */
  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    try {
      store.getState().setVoice({ listening: false, processing: true, asrStreaming: false });
      const result = await asr.stop();

      if (!result.text.trim()) {
        store.getState().setVoice({ processing: false, transcript: '', partialText: '' });
        return;
      }

      store.getState().setVoice({ transcript: result.text, partialText: '' });

      // LLM 意图理解 + 工具调用
      const systemPrompt = `你是地理教学助手。根据用户的语音指令，调用相应的地理工具。
可用工具：等高线、高程分层、二维三维切换、飞行定位、图层开关、地形夸张、课程打开、动画播放暂停。
用户指令：${result.text}`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: result.text },
      ];

      const response = await llm.chat(messages);

      // 执行工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const call of response.toolCalls) {
          await commandBus.execute({ name: call.name as never, args: call.args });
        }
      }

      // TTS 朗读回复
      if (response.text && !store.getState().voice.muted) {
        store.getState().setVoice({ speaking: true, response: response.text });
        await tts.speak(response.text);
        store.getState().setVoice({ speaking: false });
      }

      store.getState().setVoice({ processing: false });
    } catch (err) {
      store.getState().setVoice({
        processing: false,
        asrStreaming: false,
        partialText: '',
        error: err instanceof Error ? err.message : '语音处理失败',
      });
    }
  }, [asr, llm, tts, store]);

  /** 键盘事件处理 */
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.repeat) return; // 防重复
      if (isEditable(e.target)) return; // 输入框中正常输入
      if (store.getState().voice.muted) return;

      e.preventDefault();
      isRecordingRef.current = true;
      void startRecording();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditable(e.target)) return;

      e.preventDefault();
      if (isRecordingRef.current) {
        void stopRecording();
      }
    };

    /** 窗口失焦时安全结束录音 */
    const onBlur = () => {
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        asr.abort();
        store.getState().setVoice({ listening: false });
      }
    };

    /** 页面隐藏时安全结束录音 */
    const onVisibilityChange = () => {
      if (document.hidden && isRecordingRef.current) {
        isRecordingRef.current = false;
        asr.abort();
        store.getState().setVoice({ listening: false });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, startRecording, stopRecording, asr, store]);

  /** 触摸设备：麦克风按钮 */
  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      void stopRecording();
    } else {
      isRecordingRef.current = true;
      void startRecording();
    }
  }, [startRecording, stopRecording]);

  /** 打断当前旁白 */
  const interrupt = useCallback(() => {
    tts.stop();
    store.getState().setVoice({ speaking: false });
  }, [tts, store]);

  return { toggleRecording, interrupt };
}
