/**
 * 课程适配器单例
 * 提供 TTS 给 LessonRuntime 使用
 */

import { BrowserSpeechTTS, TTSAdapter, createTTSAdapter } from '../voice/adapters';

let _tts: TTSAdapter | null = null;

export function getTTS(): TTSAdapter {
  if (!_tts) {
    _tts = createTTSAdapter();
  }
  return _tts;
}

// 运行时直接导出一个共享实例给 LessonRuntime
export const tts = {
  speak: (text: string) => getTTS().speak(text),
  stop: () => getTTS().stop(),
  isSpeaking: () => getTTS().isSpeaking(),
};
