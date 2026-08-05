/**
 * LessonPlayer —— 课程播放控制条 + 问题答题卡
 *
 * - LessonPlayerBar：固定在底部，显示进度条 + 4 个按钮（上一步 / 重播 / 下一步 / 退出）
 * - QuestionCard：在当前步骤有问题时，作为"讲义层"的同级弹窗出现
 *
 * 不直接调用 Cesium API，所有操作通过 commandBus。
 */

import { useMemo } from 'react';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';
import type { LessonQuestion } from '../lessons/schema';

export function LessonPlayer() {
  const lesson = useGeographyStore((s) => s.lesson);
  const active = !!lesson.activeLessonId;
  if (!active) return null;
  return (
    <>
      <LessonPlayerBar />
      <QuestionCardLayer />
    </>
  );
}

/** 底部课程播放条 */
function LessonPlayerBar() {
  const lesson = useGeographyStore((s) => s.lesson);
  const total = Math.max(1, lesson.totalSteps);
  const current = lesson.currentStep;
  // ⚠️ Q7：百分比按「已完成步骤数 / 总步骤数」算，而不是 (current+1)/total。
  //   原 bug：刚进入 step 0 就显示 1/4 = 25%，让学生觉得"我什么都没做已经走了 1/4 课"。
  //   正确：step 0 = 0%，step 1 = 1/4 = 25% … 最后一步 finished=true 才到 100%。
  const pct = lesson.finished
    ? 100
    : Math.round((current / total) * 100);
  const atFirst = current <= 0;
  const atLast = current >= total - 1 || !!lesson.finished;
  const paused = !!lesson.isPaused;

  const prev = () => void commandBus.execute({ name: 'lesson.prevStep', args: {} });
  const replay = () => void commandBus.execute({ name: 'lesson.replayStep', args: {} });
  const next = () => void commandBus.execute({ name: 'lesson.nextStep', args: {} });
  const close = () => void commandBus.execute({ name: 'lesson.close', args: {} });
  const pause = () => void commandBus.execute({
    name: paused ? 'lesson.resume' : 'lesson.pause',
    args: {},
  });

  return (
    <div className="fixed bottom-2 left-1/2 z-30 w-[94%] max-w-3xl -translate-x-1/2">
      <div className="rounded-2xl bg-ink-900/85 p-3 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md animate-slide-up">
        {/* 标题 + 进度文字 */}
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-tight">
              {lesson.stepTitle || '地理课程'}
              {paused && !lesson.finished && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 align-middle">
                  已暂停
                </span>
              )}
              {lesson.finished && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 align-middle">
                  已完成
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-xs text-white/50 tabular-nums">
            {Math.min(current + 1, total)} / {total}
          </div>
        </div>
        {/* 进度条 */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-geo-400 to-geo-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* 按钮 */}
        <div className="flex items-center justify-between gap-2">
          <button
            data-agent-button="lesson.close"
            onClick={close}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 active:scale-[0.98]"
          >
            退出
          </button>
          <div className="flex items-center gap-2">
            <button
              data-agent-button="lesson.prev"
              disabled={atFirst}
              onClick={prev}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              上一步
            </button>
            <button
              data-agent-button="lesson.pause"
              onClick={pause}
              disabled={!!lesson.finished}
              title={paused ? '继续播放' : '暂停'}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {paused ? '继续' : '暂停'}
            </button>
            <button
              data-agent-button="lesson.replay"
              onClick={replay}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/15 active:scale-[0.98]"
              title="重播当前讲解"
            >
              重播
            </button>
            <button
              data-agent-button="lesson.next"
              disabled={atLast}
              onClick={next}
              className="rounded-lg bg-geo-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-geo-400 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              {atLast ? '已完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 问题答题卡（读取当前步骤的 question + 判题结果） */
function QuestionCardLayer() {
  const lesson = useGeographyStore((s) => s.lesson);
  const ui = useGeographyStore((s) => s.ui);
  // 从 runtime 获取当前 question（更可靠，因为 store 里只存了 narration）
  // ⚠️ Q7 安全：runtime 在 CesiumReady 之前可能是 undefined（activeLessonId 也是 null），
  //     但如果 activeLessonId 是真的（= 已经由 commandBus.setContext({lesson}) 注入），runtime 必存在。
  //     加一层 ?.getCurrentQuestion?.() 防御，避免"手动给 store 写 activeLessonId 但 lesson 单例没注入"导致 crash。
  const runtime = commandBus.getContext()?.lesson;
  const question: LessonQuestion | undefined = runtime && typeof runtime.getCurrentQuestion === 'function'
    ? runtime.getCurrentQuestion()
    : undefined;
  // 只在有活动课程且当前步骤有 question 时显示
  const show = !!lesson.activeLessonId && !!question;
  const result = ui.lastQuestionResult;
  const letters = useMemo(() => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], []);

  if (!show || !question) return null;

  const options = question.options ?? [];
  const pick = (optText: string) => {
    void commandBus.execute({
      name: 'question.checkAnswer',
      args: { answer: optText },
    });
  };

  return (
    <div className="fixed bottom-28 left-1/2 z-30 w-[94%] max-w-2xl -translate-x-1/2 px-1 animate-fade-in">
      <div className="rounded-2xl bg-ink-800/95 p-4 text-white shadow-2xl ring-1 ring-geo-500/25 backdrop-blur-md">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded bg-geo-500/20 px-2 py-0.5 text-[11px] font-semibold text-geo-300">
            练习 · {question.type === 'choice' ? '选择题' : '简答题'}
          </span>
          {result && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                result.correct
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {result.correct ? '回答正确' : '回答错误'}
            </span>
          )}
        </div>

        <div className="mb-3 text-sm font-medium leading-relaxed text-white/95">
          {question.question}
        </div>

        {/* 选项 */}
        {options.length > 0 && (
          <div className="grid gap-2">
            {options.map((optText, idx) => {
              const letter = letters[idx] ?? String(idx + 1);
              const picked =
                !!ui.lastUserAnswer &&
                (ui.lastUserAnswer === optText ||
                  ui.lastUserAnswer === letter ||
                  ui.lastUserAnswer === `${letter}.`);
              const isCorrectOpt =
                (typeof question.answer === 'string' ? question.answer : question.answer[0]) ===
                optText;
              // 结果样式：已判题 → 对/错色；未判题 → 默认
              let optCls =
                'flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 cursor-pointer transition';
              if (result) {
                if (isCorrectOpt) {
                  optCls =
                    'flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-left text-sm text-emerald-100 cursor-default';
                } else if (picked) {
                  optCls =
                    'flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-left text-sm text-rose-100 cursor-default';
                } else {
                  optCls =
                    'flex items-start gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left text-sm text-white/60 cursor-default';
                }
              }
              return (
                <button
                  type="button"
                  key={`${question.id}-${idx}`}
                  data-agent-button={`question.option.${letters[idx] ?? idx}`}
                  disabled={!!result}
                  onClick={() => pick(optText)}
                  className={optCls}
                >
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-[11px] font-bold text-white/80">
                    {letter}
                  </span>
                  <span className="leading-relaxed">{optText}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 简答输入框 */}
        {options.length === 0 && question.type === 'short-answer' && (
          <ShortAnswerInput question={question} />
        )}

        {/* 解析 */}
        {result && result.explanation && (
          <div className="mt-3 rounded-lg border border-white/5 bg-black/25 p-3 text-xs leading-relaxed text-white/80">
            <span className="font-semibold text-geo-300">解析：</span>
            {result.explanation}
          </div>
        )}
      </div>
    </div>
  );
}

/** 简答输入框 */
function ShortAnswerInput({ question }: { question: LessonQuestion }) {
  const ui = useGeographyStore((s) => s.ui);
  if (ui.lastQuestionResult) return null; // 已判题不显示输入框
  return (
    <div className="flex items-center gap-2">
      <input
        className="h-9 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-geo-500/60"
        placeholder="请输入你的答案..."
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.currentTarget.value || '').trim()) {
            void commandBus.execute({
              name: 'question.checkAnswer',
              args: { answer: e.currentTarget.value },
            });
          }
        }}
      />
      <button
        data-agent-button="question.submitAnswer"
        className="h-9 rounded-lg bg-geo-500 px-3 text-xs font-semibold text-white hover:bg-geo-400 active:scale-[0.98]"
        onClick={(e) => {
          const input = (e.currentTarget
            .previousElementSibling as HTMLInputElement | null);
          const v = (input?.value || '').trim();
          if (v) {
            void commandBus.execute({
              name: 'question.checkAnswer',
              args: { answer: v },
            });
          }
        }}
      >
        提交
      </button>
    </div>
  );
}
