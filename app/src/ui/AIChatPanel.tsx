/**
 * AIChatPanel —— AI 地理助教对话卡（黑白简约风）
 *
 * 设计语言：极简黑白 + 1px 线框 + 克制的灰度阶。无彩色、无玻璃态、无辉光。
 * 入口：TopBar 右上角 AI 按钮。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';
import type { AIChatMessage, AIToolCallVisual } from '../state/sceneState';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Loader2,
  Minimize2,
  Send,
  Sparkles,
  XCircle,
  X,
} from './icons';

/* ========== 调色板：纯黑白灰 ========== */
const C = {
  /* 外壳 */
  panelBg:   '#ffffff',
  panelEdge: '#111111',
  /* 文字 */
  textMain:  '#111111',
  textMute:  '#6b6b6b',
  textDim:   '#9a9a9a',
  /* 中性灰面 */
  bgSoft:    '#f5f5f5',
  bgSofter:  '#fafafa',
  rule:      '#e5e5e5',
  /* 用户气泡：黑底白字 */
  userBg:    '#111111',
  userText:  '#ffffff',
  /* AI 气泡：白底黑字 + 1px 描边 */
  aiBg:      '#ffffff',
  aiText:    '#111111',
  /* 状态色（仅用灰度阶，保持"黑白"调性） */
  ok:        '#111111',
  warn:      '#6b6b6b',
  err:       '#111111',
  running:   '#111111',
  errBg:     '#f5f5f5',
  /* 工具卡 */
  toolBg:    '#fafafa',
  toolBorder:'#e5e5e5',
  codeBg:    '#f5f5f5',
};

const STATUS_TONE: Record<
  AIToolCallVisual['status'],
  { label: string; dot: string; text: string }
> = {
  pending: { label: '待执行', dot: C.textDim, text: C.textDim },
  running: { label: '执行中', dot: C.textMain, text: C.textMain },
  success: { label: '完成',   dot: C.textMain, text: C.textMain },
  error:   { label: '失败',   dot: C.textMain, text: C.textMain },
};

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/* ========== 工具调用卡（极简折叠：线框 + 小字号） ========== */
function ToolCallCard({ tc }: { tc: AIToolCallVisual }) {
  const tone = STATUS_TONE[tc.status];
  const [open, setOpen] = useState(tc.status === 'error' || tc.status === 'running');
  const argsPreview = useMemo(() => {
    try {
      const s = JSON.stringify(tc.args ?? {}, null, 2);
      return s === '{}' ? '' : s;
    } catch { return ''; }
  }, [tc.args]);
  const resultPreview = useMemo(() => {
    try {
      if (!tc.result) return '';
      const s = JSON.stringify(tc.result, null, 2);
      return s.length > 500 ? s.slice(0, 500) + '\n…' : s;
    } catch { return ''; }
  }, [tc.result]);

  return (
    <div
      className="mt-2 rounded-none px-3 py-2 text-[11px]"
      style={{
        background: C.toolBg,
        border: `1px solid ${C.toolBorder}`,
        // 左侧 2px 强调边：黑白风格的结构锚点
        borderLeft: `2px solid ${C.panelEdge}`,
      }}
    >
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="w-3 h-3" style={{ color: C.textMute }} />
          : <ChevronRight className="w-3 h-3" style={{ color: C.textMute }} />}
        <span className="font-medium truncate tracking-tight" style={{ color: C.textMain, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {tc.name}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {tc.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" style={{ color: tone.text }} />}
          {tc.status === 'success' && <CircleCheck className="w-3 h-3" style={{ color: tone.text }} />}
          {tc.status === 'error' && <XCircle className="w-3 h-3" style={{ color: tone.text }} />}
          {tc.status === 'pending' && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
          )}
          <span className="text-[10px] tracking-wide uppercase" style={{ color: tone.text }}>
            {tone.label}
          </span>
        </span>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {argsPreview && (
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: C.textDim }}>
                参数
              </div>
              <pre className="rounded-none text-[11px] leading-[1.65] p-2 overflow-x-auto whitespace-pre-wrap break-words" style={{ background: C.codeBg, color: C.textMain, border: `1px solid ${C.panelEdge}` }}>
{argsPreview}
              </pre>
            </div>
          )}
          {resultPreview && (
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: C.textDim }}>
                结果
              </div>
              <pre className="rounded-none text-[11px] leading-[1.65] p-2 overflow-x-auto whitespace-pre-wrap break-words" style={{ background: C.codeBg, color: C.textMain, border: `1px solid ${C.panelEdge}` }}>
{resultPreview}
              </pre>
            </div>
          )}
          {tc.errorMessage && (
            <div className="rounded-none text-[11px] leading-[1.65] p-2" style={{ background: C.errBg, color: C.err, border: `1px solid ${C.panelEdge}`, borderLeft: `2px solid ${C.panelEdge}` }}>
              {tc.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========== 气泡 ========== */
function MessageBubble({
  m,
  onRetry,
}: {
  m: AIChatMessage;
  onRetry?: (role: 'user' | 'assistant') => void;
}) {
  const isUser = m.role === 'user';
  const isRetryable = m.role === 'user' || m.role === 'assistant';
  const canRetry =
    !!onRetry &&
    isRetryable &&
    (!!m.errorMessage ||
      (m.role === 'assistant' && !!m.toolCalls?.some((tc) => tc.status === 'error')));
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col max-w-[86%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* 元信息：极简，小号字 */}
        <div className="flex items-center gap-1.5 text-[10px] mb-1 tracking-tight" style={{ color: C.textDim }}>
          {!isUser && <Bot className="w-2.5 h-2.5" style={{ color: C.textMute }} />}
          <span>{isUser ? '你' : '助教'}</span>
          <span>· {formatTs(m.createdAt)}</span>
          {m.done === false && (
            <span className="inline-flex items-center gap-1" style={{ color: C.textMute }}>
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              生成中
            </span>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetry?.(m.role as 'user' | 'assistant')}
              className="ml-1 inline-flex items-center gap-1 px-1.5 transition hover:underline"
              style={{ color: C.textMain }}
              title={isUser ? '重新发送' : '重新生成'}
            >
              <span className="text-[10px] underline-offset-2">{isUser ? '重发' : '重试'}</span>
            </button>
          )}
        </div>

        {isUser ? (
          <div
            className="rounded-none px-3 py-2 text-[13px] leading-[1.7] whitespace-pre-wrap break-words"
            style={{
              background: C.userBg,
              color: C.userText,
              border: `2px solid ${C.panelEdge}`,
            }}
          >
            {m.content || <span style={{ opacity: 0.5 }}>（空消息）</span>}
          </div>
        ) : (
          <div
            className="rounded-none px-3 py-2.5 text-[13px] leading-[1.7] whitespace-pre-wrap break-words"
            style={{
              background: C.aiBg,
              color: C.aiText,
              border: `1px solid ${C.panelEdge}`,
              borderLeft: `2px solid ${C.panelEdge}`,
            }}
          >
            {m.content ? (
              <span>{m.content}</span>
            ) : (
              <span className="inline-flex items-center gap-2" style={{ color: C.textMute }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                思考中…
              </span>
            )}
            {m.errorMessage && (
              <div className="mt-2 rounded-none text-xs leading-[1.7] p-2" style={{
                background: C.errBg,
                color: C.err,
                border: `1px solid ${C.panelEdge}`,
                borderLeft: `2px solid ${C.panelEdge}`,
              }}>
                {m.errorMessage}
              </div>
            )}
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="mt-1 space-y-1">
                {m.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} tc={tc} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== 主组件 ========== */
export function AIChatPanel() {
  const open = useGeographyStore((s) => s.ui.showAIChat);
  const history = useGeographyStore((s) => s.ui.aiChatHistory);
  const generating = useGeographyStore((s) => s.ui.aiChatGenerating);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [input, setInput] = useState('');
  const [minimized, setMinimized] = useState(false);
  const prevCountRef = useRef<number>(0);
  // 粘性底部：如果用户主动向上拉了超过 60px，暂停自动滚底；用户滚回底部附近时恢复
  const userPinnedToBottomRef = useRef(true);
  const lastMsgIdRef = useRef<string | null>(null);

  /* ========== 自动滚到底（智能） ========== */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 消息数量变化 或 生成中（流式输出 content 变化也需要滚动）
    const needPing = history.length !== prevCountRef.current || generating;
    // 记录最新消息 id（用于流式变化时也能触发 scroll）
    const tail = history[history.length - 1]?.id ?? null;
    const tailChanged = tail !== lastMsgIdRef.current;
    lastMsgIdRef.current = tail;
    prevCountRef.current = history.length;

    if (needPing || tailChanged) {
      if (userPinnedToBottomRef.current) {
        requestAnimationFrame(() => {
          const e = scrollRef.current;
          if (!e) return;
          e.scrollTop = e.scrollHeight;
        });
      }
    }
  }, [history, generating, open, minimized, input]);

  /* ========== 监听滚动：用户是否贴底 ========== */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const THRESHOLD = 60; // 距离底部 60px 内视为"粘性底"
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      userPinnedToBottomRef.current = distance <= THRESHOLD;
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, minimized]);

  /* ========== 打开面板后聚焦输入框 ========== */
  useEffect(() => {
    if (open && !minimized && !generating && input === '') {
      const t = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, minimized, generating, input]);

  /* ========== 全局快捷键已经全部迁移到 App.tsx 统一处理 ==========
   * 之前：AIChatPanel 与 App.tsx 同时注册 window keydown → 两个监听同时跑
   * 问题：①Ctrl+/ 时 isEditable 判断各自 return，在 textarea 聚焦时两边都跳过导致快捷键失效
   *      ②Esc 重复调用 close，虽然状态幂等但浪费事件
   * 现在：只在 App.tsx 注册一份全局 Ctrl+/、Esc、Cmd+K、?、Space
   *      AIChatPanel 内部只保留 textarea 的局部快捷键（↑ 载入上一条、Enter/Shift+Enter）
   * ==================================================================== */
  // （此 useEffect 已移除。Esc/Ctrl+/ 的响应现在只在 App.tsx 里，保证唯一且正确处理焦点）

  const lastUserMessage = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user' && history[i].content && history[i].content.trim()) {
        return history[i].content;
      }
    }
    return null;
  }, [history]);

  /* ========== 发送消息 ========== */
  const doSend = async (overrideMessage?: string) => {
    const v = (overrideMessage ?? input).trim();
    if (!v) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await commandBus.execute({ name: 'aiChat.send', args: { message: v } });
    } catch { /* 已在内部捕获 */ }
  };

  /* ========== 错误重试 ========== */
  const handleRetry = (role: 'user' | 'assistant') => {
    if (role === 'user') {
      // 重新发送用户消息：取最后一条 user content
      const last = lastUserMessage;
      if (last) void doSend(last);
    } else {
      // assistant 失败：重新跑最后一条 user 消息（服务端不会记住 history 的局部失败重放，所以重发用户最后一句等价于重跑）
      const last = lastUserMessage;
      if (last) void doSend(last);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    // ↑：当输入框为空且光标在第一行时 → 把上一条用户消息载入 input
    if (e.key === 'ArrowUp' && input === '' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      if (lastUserMessage) {
        e.preventDefault();
        setInput(lastUserMessage);
        // 聚焦后把光标放末尾
        requestAnimationFrame(() => {
          const t = textareaRef.current;
          if (!t) return;
          t.style.height = 'auto';
          t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
          const L = t.value.length;
          try { t.setSelectionRange(L, L); } catch (e) { console.warn('[EmptyCatch] ui/AIChatPanel.tsx:368', (e as any)?.message ?? e); }
        });
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void doSend();
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    setInput(el.value);
  };

  const clearAll = () => commandBus.execute({ name: 'aiChat.clear', args: {} });
  const closePanel = () => commandBus.execute({ name: 'aiChat.close', args: {} });
  const toggleMin = () => setMinimized((v) => !v);

  if (!open) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-40 w-[min(92vw,420px)] max-h-[82vh] flex flex-col overflow-hidden"
      style={{
        background: C.panelBg,
        // 加粗外框：2px 纯黑边框 + 黑白风格"硬阴影"
        border: `2px solid ${C.panelEdge}`,
        boxShadow: `8px 8px 0 0 rgba(0,0,0,0.12)`,
      }}
    >
      {/* ============ 标题栏：2px 粗分隔线 ============ */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{
          borderBottom: `2px solid ${C.panelEdge}`,
        }}
      >
        <div
          className="w-8 h-8 inline-flex items-center justify-center shrink-0"
          style={{
            background: C.panelBg,
            border: `2px solid ${C.panelEdge}`,
            color: C.textMain,
          }}
          aria-hidden
        >
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 leading-tight min-w-0">
          <div className="truncate text-[13.5px] font-semibold tracking-tight" style={{ color: C.textMain }}>
            AI 地理助教
          </div>
          <div className="text-[10.5px] truncate" style={{ color: C.textMute }}>
            {generating ? '正在生成回复…' : 'Ctrl+/ 呼出 · Esc 关闭 · ↑ 载入上一条'}
          </div>
        </div>

        <button
          data-agent-button="ai.chat.minimize"
          onClick={toggleMin}
          aria-label={minimized ? '展开 AI 对话' : '折叠 AI 对话'}
          title={minimized ? '展开' : '折叠'}
          className="w-7 h-7 inline-flex items-center justify-center transition hover:bg-black/5"
          style={{ color: C.textMute, border: `1px solid ${C.rule}` }}
        >
          {minimized ? <ChevronDown className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          data-agent-button="ai.chat.close"
          onClick={closePanel}
          aria-label="关闭 AI 对话"
          title="关闭（Esc）"
          className="w-7 h-7 inline-flex items-center justify-center transition hover:bg-black/5"
          style={{ color: C.textMute, border: `1px solid ${C.rule}` }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {minimized ? (
        <div
          onClick={toggleMin}
          className="px-4 py-3 text-[11px] flex items-center gap-2 cursor-pointer select-none transition hover:bg-black/5"
          style={{ color: C.textMute, borderTop: `1px solid ${C.rule}` }}
        >
          <Sparkles className="w-3 h-3" style={{ color: C.textMain }} />
          <span>共 {history.length} 条对话 · 点击展开</span>
        </div>
      ) : (
        <>
          {/* ============ 消息区：space-y-4 行高节奏 ============ */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            style={{ minHeight: history.length === 0 ? 260 : undefined }}
          >
            {history.length === 0 ? (
              <EmptyState onPick={(s) => { setInput(s); setTimeout(() => textareaRef.current?.focus(), 20); }} />
            ) : (
              history.map((m) => <MessageBubble key={m.id} m={m} onRetry={handleRetry} />)
            )}
          </div>

          {/* ============ 输入区：2px 粗分隔线 + 2px 聚焦环 ============ */}
          <div className="px-3 py-3" style={{ borderTop: `2px solid ${C.panelEdge}` }}>
            <style>{`
              .ai-chat-composer__input::placeholder { color: ${C.textDim} !important; opacity: 1 !important; }
              .ai-chat-composer__input:focus {
                outline: none !important;
                border-color: ${C.panelEdge} !important;
                box-shadow: 0 0 0 1px ${C.panelEdge} inset, 0 0 0 0 ${C.panelEdge} !important;
                border-width: 2px !important;
              }
            `}</style>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onInput}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="飞到北京 / 切换卫星图 / 讲解季风…"
                disabled={generating}
                className="ai-chat-composer__input flex-1 resize-none rounded-none px-3 py-2 text-[13px] disabled:opacity-50"
                style={{
                  background: C.panelBg,
                  color: C.textMain,
                  border: `1px solid ${C.panelEdge}`,
                  lineHeight: 1.65,
                }}
              />
              <button
                data-agent-button="ai.chat.send"
                aria-label="发送"
                onClick={() => void doSend()}
                disabled={!input.trim() || generating}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: input.trim() && !generating ? C.panelEdge : C.bgSoft,
                  color: input.trim() && !generating ? '#ffffff' : C.textDim,
                  border: `2px solid ${C.panelEdge}`,
                }}
              >
                {generating
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10.5px] px-1 tracking-tight" style={{ color: C.textDim }}>
              {history.length >= 2 ? (
                <button
                  type="button"
                  onClick={() => void clearAll()}
                  className="transition hover:underline"
                  style={{ color: C.textMute }}
                >
                  清空对话
                </button>
              ) : (
                <span />
              )}
              {generating ? (
                <span className="inline-flex items-center gap-1" style={{ color: C.textMute }}>
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  生成中…（Esc 关闭面板）
                </span>
              ) : (
                <span>Enter 发送 · Shift+Enter 换行 · Ctrl+/ 隐藏面板</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ========== 空态：黑白极简卡片 ========== */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  const prompts: { label: string; example: string }[] = [
    { label: '镜头', example: '飞到珠穆朗玛峰，拉到 10 公里高' },
    { label: '图层', example: '切换卫星影像，打开等高线图层' },
    { label: '讲解', example: '讲一讲为什么中国季风区雨热同期' },
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center py-6 gap-4">
      <div className="text-center w-full">
        <div
          className="w-10 h-10 mx-auto inline-flex items-center justify-center mb-3"
          style={{ background: C.panelBg, border: `1px solid ${C.panelEdge}`, color: C.textMain }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="text-[14px] font-medium tracking-tight" style={{ color: C.textMain }}>
          探索这颗星球
        </div>
        <div className="text-[11px] mt-1" style={{ color: C.textMute }}>
          地理问题、镜头飞行、图层切换，写成一句话即可
        </div>
      </div>

      <div className="w-full grid gap-2 px-2">
        {prompts.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p.example)}
            className="group text-left rounded-none px-3 py-2 transition"
            style={{
              background: C.panelBg,
              border: `1px solid ${C.toolBorder}`,
              borderLeft: `2px solid ${C.panelEdge}`,
            }}
          >
            <div className="text-[10px] uppercase tracking-widest" style={{ color: C.textMute }}>
              {p.label}
            </div>
            <div className="text-[12px] mt-0.5 tracking-tight" style={{ color: C.textMain }}>
              {p.example}
              <span className="ml-1 opacity-0 group-hover:opacity-100 transition" style={{ color: C.textMute }}>→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
