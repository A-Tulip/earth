/**
 * SubtitleLayer —— 底部字幕层 + 讲义层
 *
 * - 字幕：底部一到两行，显示语音识别结果和 AI 回复
 * - 讲义层：底部向上展开，高度约屏幕 1/4，地图保持可见
 *
 * 讲义层内容经过 DOMPurify 清理（见 src/ui/sanitize.ts），
 * 通过 sandbox iframe 隔离样式与脚本，防止 XSS。
 */

import { useMemo } from 'react';
import { useGeographyStore } from '../state/store';
import { renderSanitizedMarkdown } from './sanitize';

export function SubtitleLayer() {
  const voice = useGeographyStore((s) => s.voice);
  const ui = useGeographyStore((s) => s.ui);
  const setUI = useGeographyStore((s) => s.setUI);

  // 讲义内容清理（仅在内容变化时重算）
  const sanitizedLecture = useMemo(
    () => (ui.lectureContent ? renderSanitizedMarkdown(ui.lectureContent) : ''),
    [ui.lectureContent],
  );

  // 讲义层
  if (ui.showLecturePanel && sanitizedLecture) {
    return (
      <div className="fixed bottom-20 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4">
        <div className="max-h-[25vh] overflow-y-auto rounded-xl bg-ink-800/90 p-4 text-sm leading-relaxed text-white/90 backdrop-blur-md ring-1 ring-geo-500/20 animate-slide-up">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-geo-300">讲义</span>
            <button
              onClick={() => setUI({ showLecturePanel: false, lectureContent: '' })}
              className="rounded px-2 py-0.5 text-xs text-white/60 hover:bg-white/10"
            >
              收起
            </button>
          </div>
          {/* 讲义 HTML 已通过 DOMPurify 清理，再叠加 sandbox iframe 隔离 */}
          <iframe
            title="lecture-sandbox"
            sandbox="allow-same-origin"
            className="w-full border-0 bg-transparent"
            style={{ minHeight: '60px', maxHeight: '22vh' }}
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>
              body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',sans-serif;color:#e5e7eb;font-size:13px;line-height:1.7;margin:0;background:transparent;}
              h1,h2,h3,h4{color:#fff;font-weight:600;margin:0.6em 0 0.3em;}
              h1{font-size:16px;}h2{font-size:15px;}h3{font-size:14px;}h4{font-size:13px;}
              table{border-collapse:collapse;width:100%;margin:0.5em 0;}
              th,td{border:1px solid rgba(255,255,255,0.15);padding:4px 8px;text-align:left;}
              th{background:rgba(255,255,255,0.05);}
              code{background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-family:ui-monospace,monospace;}
              pre{background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;overflow:auto;}
              pre code{background:transparent;padding:0;}
              a{color:#7dd3fc;text-decoration:none;}
              blockquote{border-left:3px solid rgba(125,211,252,0.5);margin:0.5em 0;padding-left:12px;color:#cbd5e1;}
              ul,ol{padding-left:1.4em;margin:0.4em 0;}
            </style></head><body>${sanitizedLecture}</body></html>`}
          />
        </div>
      </div>
    );
  }

  // 字幕
  const showSubtitle = voice.listening || voice.processing || voice.speaking || voice.transcript || voice.response;
  if (!showSubtitle) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 px-4">
      <div className="max-w-2xl text-center">
        {/* 正在聆听 + 实时 partial 文本 */}
        {voice.listening && (
          <>
            {voice.asrStreaming ? (
              <div className="flex items-center justify-center gap-2 text-sm text-geo-300">
                <SoundWave />
                <span className="font-mono text-white/90 transition-opacity duration-150">
                  {voice.partialText || '聆听中...'}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-geo-300 animate-pulse-soft">
                <SoundWave />
                <span>正在聆听...</span>
              </div>
            )}
          </>
        )}

        {/* 识别最终文本 */}
        {!voice.listening && voice.transcript && !voice.processing && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-white backdrop-blur-sm ring-1 ring-geo-500/20">
            {voice.transcript}
          </div>
        )}

        {/* 处理中 */}
        {voice.processing && (
          <div className="text-sm text-white/60 animate-pulse-soft">正在理解...</div>
        )}

        {/* AI 回复 */}
        {voice.response && !voice.speaking && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-white/90 backdrop-blur-sm ring-1 ring-geo-500/20 animate-fade-in">
            {voice.response}
          </div>
        )}

        {/* 朗读中 */}
        {voice.speaking && voice.response && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-geo-300 backdrop-blur-sm ring-1 ring-geo-500/20">
            {voice.response}
          </div>
        )}

        {/* 错误 */}
        {voice.error && (
          <div className="rounded-lg bg-red-900/80 px-4 py-2 text-sm text-red-200 backdrop-blur-sm">
            {voice.error}
          </div>
        )}
      </div>
    </div>
  );
}

/** 声波动画 */
function SoundWave() {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block w-0.5 rounded-full bg-geo-300"
          style={{
            height: '12px',
            animation: `soundWave 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes soundWave {
          0% { height: 4px; }
          100% { height: 16px; }
        }
      `}</style>
    </div>
  );
}
