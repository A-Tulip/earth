/**
 * LessonRuntime —— 课程播放器
 *
 * 管理课程加载、播放、暂停、恢复、推进。
 * 通过 Command Bus 执行场景操作，不直接操作 Cesium。
 */

import { LessonPackage, LessonStep } from './schema';
import { commandBus } from '../commands/bus';
import type { ToolResult } from '../commands/schema';
import { useGeographyStore } from '../state/store';
import { normalizeBasemap } from '../state/sceneState';
import { tts as ttsAdapter } from './singletons';
import { findFirstMention } from './geoReferencer';
// ✅ ISSUE-6：LessonRuntime 可注入 LLM 适配器，用于：
//   1. 当步骤提供 aiPrompt 但 narration 为空时，动态生成中文旁白（不写死）
//   2. 暴露 askAI() 方法，供学生在上课期间随时向 AI 提问当前课程内容
import type { LLMAdapter, LLMMessage } from '../voice/adapters';

export class LessonRuntime {
  private currentLesson: LessonPackage | null = null;
  private currentStepIndex = 0;
  private isPaused = false;
  /** 旁白过程中：命中地理名词后，安排一个"多少秒后飞行"的取消令牌 */
  private narrationTimers: number[] = [];
  /** 自动进入下一步的定时句柄（用户暂停/退出/重播/跳步时需取消） */
  private autoAdvanceTimer: number | null = null;
  // ✅ ISSUE-6：可选的 LLM 适配器（App 启动时通过 setLLMAdapter 注入；未注入时走"离线"路径，不会 crash）
  private llm: LLMAdapter | null = null;

  /** 注入 LLM 适配器（非侵入式：未调用则所有 AI 功能走降级，不影响既有课程） */
  setLLMAdapter(adapter: LLMAdapter | null): void {
    this.llm = adapter;
  }

  /**
   * ✅ ISSUE-6：向 AI 提问（基于当前课程上下文）
   * 场景：学生上课中说"刚才那个地方我没听懂""解释一下这一步的原理""为什么要选 A"
   *       调用后返回中文解释，可进一步交由 TTS 朗读或写入 SubtitleLayer。
   *
   * @param question 学生问题（中文）
   * @param options.includeStepContext 是否把当前步骤的 title/narration 一并喂给 LLM（默认 true）
   * @param options.maxWords 解释上限（约略字数，防止 LLM 长篇大论，默认 180 字）
   */
  async askAI(
    question: string,
    options: { includeStepContext?: boolean; maxWords?: number } = {},
  ): Promise<string> {
    const { includeStepContext = true, maxWords = 180 } = options;
    if (!question.trim()) return '';

    const lesson = this.currentLesson;
    const stepIndex = this.currentStepIndex;
    const step = lesson?.steps[stepIndex];

    // --- LLM 未注入：给出静态降级答案，保证课堂不中断 ---
    if (!this.llm) {
      const base = '当前为离线模式：暂时无法用 AI 扩展讲解。';
      if (lesson) return `${base}建议回到课程文本：${lesson.meta.title} 第 ${stepIndex + 1} 步「${step?.title ?? ''}」。`;
      return `${base}你可以使用工具坞手动操作地球，或切换到联网模式。`;
    }

    const messages: LLMMessage[] = [];
    const contextParts: string[] = [
      `你是初高中地理课 AI 讲解助手。请用中文、简洁准确、符合课标的方式回答学生问题。`,
      `回答长度控制在 ${maxWords} 字以内，避免展开过深；需要扩展时建议学生课后查阅对应教材章节。`,
      `不要编造虚假地理数据或未验证结论。`,
    ];
    if (includeStepContext && lesson) {
      contextParts.push('');
      contextParts.push(`【课程上下文】`);
      contextParts.push(`课程：${lesson.meta.title}（${lesson.meta.grade}，${lesson.meta.curriculumStandard}）`);
      contextParts.push(`教学目标：${lesson.meta.objectives.join('；')}`);
      if (step) {
        contextParts.push(`当前步骤 ${stepIndex + 1}/${lesson.steps.length}：${step.title}`);
        if (step.narration) contextParts.push(`旁白要点：${step.narration}`);
        if (step.lecture) contextParts.push(`讲义片段：${step.lecture.slice(0, 400)}`);
        if (step.question) contextParts.push(`本步问题：${step.question.question} | 正确答案：${Array.isArray(step.question.answer) ? step.question.answer.join(' / ') : step.question.answer}`);
      }
    }
    messages.push({ role: 'system', content: contextParts.join('\n') });
    messages.push({ role: 'user', content: question });

    try {
      const resp = await this.llm.chat(messages);
      const text = (resp.text ?? '').trim();
      if (!text) {
        return lesson
          ? `AI 暂时没有返回解释。请参考 ${lesson.meta.title} 第 ${stepIndex + 1} 步的讲义与注释。`
          : 'AI 暂时没有返回回答，请稍后再试。';
      }
      return text;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return `AI 服务暂不可用（${m.slice(0, 40)}）。建议先阅读本课讲义，或用工具坞切换底图/图层自行观察地球。`;
    }
  }

  /** 取消任何已计划的自动进入下一步（暂停 / 跳步 / 退出 / 重播时统一调用） */
  private cancelAutoAdvance(): void {
    if (this.autoAdvanceTimer != null) {
      window.clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  /** 统一写入"课程已结束"的 finished 状态（playStep 最后一步 / nextStep 越界共用，避免重复文案） */
  private markFinished(): void {
    const store = useGeographyStore.getState();
    store.setLesson({
      stepTitle: '课程已结束',
      narration: '你可以按"退出"结束，或按"上一步"回看。',
      isPaused: true,
      finished: true,
    });
  }

  // ================ Q7 课程加载性能优化 ================
  /** 课程内容 import 结果内存缓存：避免"点同个课程第二次"又重新 import + 解析 AST */
  private static readonly lessonCache = new Map<string, Promise<LessonPackage | null>>();
  /** 课程元数据预热（启动/菜单打开时异步加载 import 模块，第一次点击直接命中缓存） */
  private static readonly warmUpIds = new Set<string>();

  /** 预热课程 import：只拉模块不解析 JSON（动态 import 会走 Vite chunk，缓存 HTTP/磁盘 cache + ES module registry） */
  static warmUpLesson(lessonId: string): void {
    if (LessonRuntime.warmUpIds.has(lessonId)) return;
    LessonRuntime.warmUpIds.add(lessonId);
    // 不 await：后台"慢慢拉"，失败也静默（课程点击时再抛）
    void LessonRuntime.fetchLessonInternal(lessonId).catch(() => null);
  }

  /** 内部 fetchLesson（带 Promise 级缓存，避免并发打开同一课程重复触发多个 dynamic import） */
  private static fetchLessonInternal(lessonId: string): Promise<LessonPackage | null> {
    const cached = LessonRuntime.lessonCache.get(lessonId);
    if (cached) return cached;
    const p = (async () => {
      try {
        // Vite 动态 import：@content/lesson.ts 必须用字符串模板，确保 rollup 产生正确的 import-glob chunk
        const mod = await import(`@content/${lessonId}/lesson.ts`);
        return (mod.default ?? null) as LessonPackage | null;
      } catch (err) {
        // 失败时不要把 rejected promise 留在缓存里，下一次点击有机会重试
        LessonRuntime.lessonCache.delete(lessonId);
        LessonRuntime.warmUpIds.delete(lessonId);
        console.error(`[LessonRuntime] 课程加载失败 lessonId=${lessonId}`, err);
        return null;
      }
    })();
    LessonRuntime.lessonCache.set(lessonId, p);
    return p;
  }

  /** 加载课程 */
  async load(lessonId: string): Promise<void> {
    const lesson = await this.fetchLesson(lessonId);
    if (!lesson) {
      throw new Error(`课程 ${lessonId} 不存在`);
    }
    this.currentLesson = lesson;
    this.currentStepIndex = 0;
    this.isPaused = false;

    const store = useGeographyStore.getState();
    store.setLesson({
      activeLessonId: lessonId,
      currentStep: 0,
      totalSteps: lesson.steps.length,
      stepTitle: lesson.steps[0]?.title ?? '',
      narration: lesson.steps[0]?.narration ?? '',
      isPaused: false,
    });
  }

  /** 开始课程 */
  async start(): Promise<void> {
    if (!this.currentLesson) return;
    await this.playStep(0);
  }

  /** 播放指定步骤
   *
   *  Q10 讲解动画时序优化（核心改动）：
   *  ┌──────────────────────────────────────────────────────────┐
   *  │  进入步骤 t=0ms: 立即写 lecture / narration / setUI      │
   *  │                            ↓                            │
   *  │  并行开始:                                                 │
   *  │    A. applySceneConfig (视图/底图/图层/镜头/夸张/时间轴)  │
   *  │    B. 语音 TTS 朗读 (speak) + 字幕显示 (subtitle)        │
   *  │                            ↓                            │
   *  │  等 B 结束后(或 A 结束后 取最长者): 进入下一步            │
   *  └──────────────────────────────────────────────────────────┘
   *
   *  这样保证：用户"点击下一步"后立即看到字幕和讲义；同时镜头移动和语音同时进行，
   *  不再出现"镜头飞 3 秒，然后才开始说话"的冷场错位。
   */
  private async playStep(index: number): Promise<void> {
    if (!this.currentLesson || index < 0 || index >= this.currentLesson.steps.length) return;

    const step = this.currentLesson.steps[index];
    this.currentStepIndex = index;

    // ===== 第 0 阶段：动态解析旁白 narration（解决"课程不能写死"）=====
    // ✅ ISSUE-6：如果 step 未提供 narration 文案但提供了 aiPrompt → 调用 LLM 生成 1-2 句中文旁白，
    //             与 applySceneConfig 并行，不阻塞镜头动画。最长等待 15s，超时不 crash。
    let effectiveNarration = step.narration?.trim() ?? '';
    let aiNarrationPromise: Promise<string> | null = null;

    if (!effectiveNarration && step.aiPrompt && this.llm) {
      aiNarrationPromise = (async (): Promise<string> => {
        try {
          const messages: LLMMessage[] = [];
          const parts: string[] = [
            `你是初高中地理课旁白生成器。请用简洁中文，按 aiPrompt 的要求生成 1-2 句课堂旁白。`,
            `要求：口语化，符合学生认知，符合课标；不要使用 markdown；不要编造未经验证的数据；`,
            `旁白长度 60-120 字。`,
            ``,
            `【课堂上下文】`,
            `课程：${this.currentLesson?.meta.title ?? ''}（${this.currentLesson?.meta.grade ?? ''}）`,
            `教学目标：${(this.currentLesson?.meta.objectives ?? []).join('；')}`,
            `步骤：${step.title}`,
            ``,
            `【aiPrompt】\n${step.aiPrompt ?? ''}`,
          ];
          messages.push({ role: 'system', content: parts.join('\n') });
          messages.push({ role: 'user', content: '请生成本步旁白，直接输出旁白内容，不要加引号或额外说明。' });

          // 超时防御：最长 15s，超过则用降级文案，保证课堂不卡住
          const timeoutP = new Promise<string>((res) => setTimeout(() => res(''), 15_000));
          const llmP = this.llm!.chat(messages).then((r) => (r.text ?? '').trim());
          const text = await Promise.race([llmP, timeoutP]);
          return text.replace(/\s+/g, ' ').trim();
        } catch {
          // LLM 失败不中断：返回空，后续逻辑自然走"跳过 TTS 但场景照常播放"
          return '';
        }
      })();
    }

    const store = useGeographyStore.getState();
    store.setLesson({
      currentStep: index,
      stepTitle: step.title,
      narration: effectiveNarration, // 先填入已有旁白（可能为空）
      isPaused: false,
    });
    // 进入新步骤时，清空上一步的用户答案和判题结果
    store.setUI({
      lastUserAnswer: null,
      lastQuestionResult: null,
    });

    // ===== 进入步骤立即同步: 字幕 + 讲义 =====
    if (step.lecture) {
      store.setUI({ showLecturePanel: true, lectureContent: step.lecture });
    }
    // 字幕（无论静音与否，都先显示在 SubtitleLayer）：保证用户静音/无 TTS 时也能看到讲解文字
    if (effectiveNarration) {
      store.setUI({ showSubtitle: true });
      store.setVoice({ response: effectiveNarration });
    }

    // ===== 旁白时序参数（Q10：更符合中文真实朗读速度）=====
    const CHARS_PER_SECOND = 3.0;

    // ===== 地理名词延时飞行（非显式camera的步骤）—— 需要 narration，在 LLM 解析后再执行 =====
    this.clearNarrationTimers();

    // ===== 两条并发线：A. 场景动画 B. AI 旁白生成 =====
    const scenePromise = (async () => {
      try {
        await this.applySceneConfig(step);
      } catch (e) {
        console.warn('[LessonRuntime] applySceneConfig failed，继续讲解', e);
      }
    })();

    // 等 AI 旁白生成完成（若没开启则立即 resolve）
    if (aiNarrationPromise) {
      const generated = await aiNarrationPromise;
      if (generated) {
        effectiveNarration = generated;
        // 把 AI 生成的结果重新写回 lesson store + 字幕层
        store.setLesson({ narration: effectiveNarration });
        store.setUI({ showSubtitle: true });
        store.setVoice({ response: effectiveNarration });
      }
      aiNarrationPromise = null;
    }

    const narrationText = effectiveNarration;
    const narrationMs = Math.max(
      800,
      narrationText.length > 0 ? Math.round((narrationText.length / CHARS_PER_SECOND) * 1000) : 0,
    );

    // ===== 地理名词延时飞行（有显式 camera 的步骤跳过，避免和 flyTo 打架）=====
    const hasExplicitCamera = !!step.scene?.camera;
    if (!hasExplicitCamera) {
      const mention = findFirstMention(narrationText);
      if (mention) {
        const totalSec = Math.max(2, narrationText.length / CHARS_PER_SECOND);
        const hitIndex = narrationText.indexOf(mention.name);
        const mentionSec =
          hitIndex >= 0
            ? (hitIndex + mention.name.length / 2) / CHARS_PER_SECOND
            : Math.min(2.5, totalSec * 0.4);
        const delayMs = Math.max(500, Math.min(mentionSec * 1000, 15_000));
        const durationSec = Math.max(1.2, Math.min(3.2, delayMs / 1000));
        const id = window.setTimeout(() => {
          void commandBus.execute({
            name: 'camera.flyTo',
            args: {
              longitude: mention.longitude,
              latitude: mention.latitude,
              height: mention.height,
              duration: durationSec,
            },
          });
        }, delayMs);
        this.narrationTimers.push(id);
      }
    }

    // ===== 语音/字幕播放 =====
    const speakPromise = (async () => {
      if (!narrationText) return;
      const muted = useGeographyStore.getState().voice.muted;
      if (!muted) {
        store.setVoice({ speaking: true });
        try {
          await ttsAdapter.speak(narrationText);
        } catch {
          /* TTS 失败不中断课堂 */
        } finally {
          store.setVoice({ speaking: false });
        }
        return;
      }
      // 静音模式：不播语音，但要保证字幕停留一个估算时间，给用户读旁白
      await new Promise<void>((res) => {
        const id = window.setTimeout(res, narrationMs);
        this.narrationTimers.push(id);
      });
    })();

    // ✅ 课程播放超前修复：
    //   之前只等 speakPromise 并且用 Promise.race([scenePromise, 500ms]) 给场景只留 500ms
    //   这会导致 applySceneConfig 里的 camera.flyTo（通常 2-3s）还没到，自动推进器已把步骤跳到下一步，
    //   用户看到："课件一直播放着但内容还没加载完就跳到别的内容上去了"
    //   修复：旁白 + 场景动画 两者都完成 之后才允许自动推进。
    await Promise.all([speakPromise, scenePromise]);

    // 4. 显示问题（如果有），字幕一直显示，有题的步骤自动保持字幕
    if (step.question) {
      store.setUI({ showSubtitle: true });
    }

    // 5. 自动进入下一步：
    //    - 若本步骤无 question（不需要等学生回答）
    //    - 且未暂停
    //    - 且不是最后一步
    //  → 1400ms 后进入下一步（原 600ms 太短，给学生一个消化时间），
    //    若在此期间用户暂停/退出/跳步则通过 cancelAutoAdvance 立即取消
    this.cancelAutoAdvance();
    if (!this.isPaused && !step.question) {
      const isLast = this.currentStepIndex >= (this.currentLesson?.steps.length ?? 0) - 1;
      if (!isLast) {
        this.autoAdvanceTimer = window.setTimeout(() => {
          this.autoAdvanceTimer = null;
          // 再确认一次：未暂停 + 仍在同一课程同一位置（用户没手动跳步）
          if (!this.currentLesson) return;
          if (this.isPaused) return;
          const stillCorrectStep = index === this.currentStepIndex;
          if (!stillCorrectStep) return;
          void this.nextStep().catch(() => null);
        }, 1400);
      } else {
        // 最后一步自然结束：标记"完成"，不自动退出（给学生回看/自己点退出）
        // 避免最后一步用户还在跟读字幕就立即结束文案
        this.autoAdvanceTimer = window.setTimeout(() => {
          this.autoAdvanceTimer = null;
          if (!this.currentLesson) return;
          this.markFinished();
        }, 2500);
      }
    }
  }

  /** @deprecated 已统一合并进 nextStep —— 保持老接口调用不报错 */
  async advance(): Promise<void> {
    await this.nextStep();
  }

  /** 下一步：用户主动 / 自动触发。最后一步进入 finished 状态不再抛错 */
  async nextStep(): Promise<void> {
    if (!this.currentLesson) {
      throw new Error('无活动课程');
    }
    this.cancelAutoAdvance();
    const next = this.currentStepIndex + 1;
    if (next >= this.currentLesson.steps.length) {
      // 最后一步：标记完成，不抛错
      this.markFinished();
      return;
    }
    await this.playStep(next);
  }

  /** 上一步：回看之前的讲解 */
  async prevStep(): Promise<void> {
    if (!this.currentLesson) {
      throw new Error('无活动课程');
    }
    this.cancelAutoAdvance();
    const prev = this.currentStepIndex - 1;
    if (prev < 0) {
      throw new Error('已经是第一步');
    }
    await this.playStep(prev);
  }

  /** 重播当前步骤（重新讲一遍旁白 + 重新应用场景） */
  async replayStep(): Promise<void> {
    if (!this.currentLesson) {
      throw new Error('无活动课程');
    }
    this.cancelAutoAdvance();
    await this.playStep(this.currentStepIndex);
  }

  /** 关闭课程：清除 UI / 旁白 / 讲义 / 问题 / 时间动画 */
  close(): void {
    this.cancelAutoAdvance();
    ttsAdapter.stop();
    this.clearNarrationTimers();
    this.currentLesson = null;
    this.currentStepIndex = 0;
    this.isPaused = false;

    const store = useGeographyStore.getState();
    // 清除课程状态
    store.setLesson({
      activeLessonId: null,
      currentStep: 0,
      totalSteps: 0,
      stepTitle: '',
      narration: '',
      isPaused: false,
      finished: false,
    });
    // 清除讲义 + 字幕 + 问题答案
    store.setUI({
      showLecturePanel: false,
      lectureContent: '',
      showSubtitle: false,
      lastUserAnswer: null,
      lastQuestionResult: null,
    });
    // 清除语音状态
    store.setVoice({
      speaking: false,
      response: '',
      partialText: '',
      asrStreaming: false,
    });
    // 关闭时间维度
    const cur = store.time;
    store.patch({ time: { ...cur, active: false, isPlaying: false } });
    // 清除地形材质（等高线/坡度等课程可能开启）
    void commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__' } });
    // 回到首页
    void commandBus.execute({ name: 'camera.reset', args: {} });
  }

  /** 暂停 */
  pause(): void {
    this.cancelAutoAdvance();
    this.isPaused = true;
    ttsAdapter.stop();
    useGeographyStore.getState().setLesson({ isPaused: true });
  }

  /** 恢复 */
  resume(): void {
    this.cancelAutoAdvance();
    this.isPaused = false;
    useGeographyStore.getState().setLesson({ isPaused: false });
    // 恢复时：如果当前步骤无 question 且非最后一步 → 重新安排自动进入下一步（用短一点的呼吸间隔）
    if (!this.currentLesson) return;
    const step = this.currentLesson.steps[this.currentStepIndex];
    if (!step) return;
    const isLast = this.currentStepIndex >= this.currentLesson.steps.length - 1;
    if (!step.question && !isLast) {
      this.autoAdvanceTimer = window.setTimeout(() => {
        this.autoAdvanceTimer = null;
        if (!this.currentLesson || this.isPaused) return;
        void this.nextStep().catch(() => null);
      }, 800);
    }
  }

  /** 重置 */
  async reset(): Promise<void> {
    this.cancelAutoAdvance();
    if (!this.currentLesson) return;
    this.currentStepIndex = 0;
    this.isPaused = false;
    await this.playStep(0);
  }

  /** 打断当前旁白（用户开始说话时调用） */
  interrupt(): void {
    this.cancelAutoAdvance();
    ttsAdapter.stop();
    this.clearNarrationTimers();
    this.pause();
  }

  private clearNarrationTimers(): void {
    for (const id of this.narrationTimers) window.clearTimeout(id);
    this.narrationTimers.length = 0;
  }

  /** 应用场景配置
   *
   *  Q7 性能优化：把原来"逐个 await 串行"改成"阶段并行"：
   *   ┌ Phase 1: 清场（互斥，先执行）
   *   │  - clearAllTerrainMaterials（若步骤未指定 contour/elevationRamp/slope/aspect 之一为 true，则先清）
   *   │  - 时间维度开关
   *   ├ Phase 2: 状态写入 + 图层开关（可全并行）
   *   │  - 视图模式 setMode（如果和当前不同）
   *   │  - 底图 setBasemap
   *   │  - annotation/astronomy/data 所有 layer.toggle（不互相阻塞队列？实际 LayerManager 里三类 kind 不同可以并行，但我们用 Promise.all，commandBus 会按 kind 自己入队，不会互相等待）
   *   │  - 地形夸张倍数（同步写入 store，再 apply）
   *   │  - contour/elevationRamp/slope/aspect（四种互斥材质里选 1 种）
   *   ├ Phase 3: 镜头 flyTo（单独 await，避免"边飞边画地形材质"造成卡顿；也保证"到位再旁白"）
   *   └ Phase 4: 全部 settled（任何子失败只记录日志，不中断课程）
   *
   *  目标：把"每个步骤第 1 帧"从串行的 (view+basemap+图层+flyTo) 秒数叠加，变成 max(图层, 底图, 视图) + flyTo。
   */
  private async applySceneConfig(step: LessonStep): Promise<void> {
    const scene = step.scene;
    const st0 = useGeographyStore.getState();

    // ===================================
    // Phase 1：清场（地形材质、时间、等高线互斥）
    // ===================================
    const wantContour = !!scene.contour;
    const wantElevationRamp = !!scene.layers?.terrain?.elevationRamp;
    const wantSlope = !!scene.layers?.terrain?.slope;
    const wantAspect = !!scene.layers?.terrain?.aspect;
    const wantAnyTerrainMaterial = wantContour || wantElevationRamp || wantSlope || wantAspect;
    const hasAnyTerrainMaterialNow =
      st0.terrain.contour || st0.terrain.elevationRamp || st0.terrain.slope || st0.terrain.aspect;
    if (!wantAnyTerrainMaterial && hasAnyTerrainMaterialNow) {
      try {
        await commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__' } });
      } catch (e) { console.warn('[EmptyCatch] lessons/runtime.ts:558', (e as any)?.message ?? e); }
    }

    // 时间维度：先写 store（CesiumCanvas 订阅驱动时钟）；若步骤不想要时间动画则关闭
    const ta = scene.timeAnimation;
    if (ta) {
      useGeographyStore.getState().patch({
        time: {
          active: true,
          currentTime: ta.startTime,
          startTime: ta.startTime,
          endTime: ta.endTime,
          multiplier: ta.multiplier,
          isPlaying: true,
        },
      });
    } else {
      const cur = useGeographyStore.getState().time;
      if (cur.active) {
        useGeographyStore.getState().patch({
          time: { ...cur, active: false, isPlaying: false },
        });
      }
    }

    // ===================================
    // Phase 2：并行批量：视图模式 + 底图 + 图层 + 地形夸张 + (互斥材质)
    //   不同 OpKind 可并行；相同 kind 由 LayerLifeCycleManager 入队保证顺序。
    // ===================================
    const parallel: Promise<ToolResult>[] = [];

    // 视图模式（sceneMode kind）：仅当与当前不同时才发
    if (scene.viewMode && scene.viewMode !== st0.viewMode) {
      parallel.push(commandBus.execute({ name: 'view.setMode', args: { mode: scene.viewMode } }));
    }

    // 底图（basemap kind）：仅当与当前不同时才发
    if (scene.basemap) {
      const normalized = normalizeBasemap(scene.basemap);
      if (normalized !== st0.basemap) {
        parallel.push(commandBus.execute({ name: 'view.setBasemap', args: { basemap: normalized } }));
      }
    }

    // 互斥地形材质（globeMaterial kind）：四种只能选一个
    if (wantContour) {
      parallel.push(
        commandBus.execute({
          name: 'layer.showContour',
          args: { spacing: scene.contour?.spacing ?? 50 },
        }),
      );
    } else if (wantElevationRamp) {
      parallel.push(commandBus.execute({ name: 'layer.showElevationRamp', args: {} }));
    } else if (wantSlope) {
      parallel.push(commandBus.execute({ name: 'layer.showSlope', args: {} }));
    } else if (wantAspect) {
      parallel.push(commandBus.execute({ name: 'layer.showAspect', args: {} }));
    }

    // 地形夸张倍数（无互斥，立即写 store + apply）
    if (typeof scene.exaggeration === 'number') {
      parallel.push(
        commandBus.execute({
          name: 'terrain.setExaggeration',
          args: { value: scene.exaggeration },
        }),
      );
    }

    // 图层开关（annotations=annotation kind, astronomy=entities kind, data=dataLayer kind；互不相同 OpKind，可以并行 Promise.all）
    type ToggleJob = [keyof typeof st0.annotations, boolean];
    const toggleJobs: ToggleJob[] = [];
    if (scene.layers?.annotations) {
      for (const [k, v] of Object.entries(scene.layers.annotations)) {
        if ((k as keyof typeof st0.annotations) in st0.annotations) {
          toggleJobs.push([k as keyof typeof st0.annotations, !!v]);
        }
      }
    }
    if (scene.layers?.astronomy) {
      for (const [k, v] of Object.entries(scene.layers.astronomy)) {
        if ((k as keyof typeof st0.astronomy) in st0.astronomy) {
          toggleJobs.push([k as unknown as keyof typeof st0.annotations, !!v]);
        }
      }
    }
    if (scene.layers?.data) {
      for (const [k, v] of Object.entries(scene.layers.data)) {
        if ((k as keyof typeof st0.data) in st0.data) {
          toggleJobs.push([k as unknown as keyof typeof st0.annotations, !!v]);
        }
      }
    }
    // 对 annotation/astronomy/data 用 Promise.all 并行推入 commandBus.execute；
    // commandBus 会立即同步写入 store，CesiumLayerSync 的 store.subscribe 会分别触发；
    // 由于 LayerLifeCycleManager 三类 kind 不互斥，真正的 Cesium build() 可以在同一帧合并。
    for (const [layer, visible] of toggleJobs) {
      // 避免"本来已经是目标状态"的重复切换（用户体验：少一次闪烁）
      const curVal = (st0 as unknown as Record<string, boolean>)[layer as string];
      if (curVal === !!visible) continue;
      parallel.push(commandBus.execute({ name: 'layer.toggle', args: { layer, visible } }));
    }

    // 区域叠加（entities kind：进入本步绘制，若步骤无 regions 则清除上一区域）
    if (Array.isArray(scene.regions) && scene.regions.length > 0) {
      parallel.push(
        commandBus.execute({ name: 'layer.showRegion', args: { regions: scene.regions } }),
      );
    } else {
      parallel.push(commandBus.execute({ name: 'layer.clearRegion', args: {} }));
    }

    // 并行等待所有 Phase2 任务完成；任何单个失败记日志不中断
    if (parallel.length > 0) {
      try {
        const results = await Promise.allSettled(parallel);
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.ok === false) {
            console.warn('[LessonRuntime] applySceneConfig step failed', r.value);
          } else if (r.status === 'rejected') {
            console.warn('[LessonRuntime] applySceneConfig step rejected', r.reason);
          }
        }
      } catch (err) {
        console.warn('[LessonRuntime] applySceneConfig parallel error', err);
      }
    }

    // ===================================
    // Phase 3：镜头飞行（最后一步 await，保证"到位再旁白"）
    //   - 如果步骤没配 camera → 0ms
    //   - 如果飞行距离很近，flyTo 内部的 camera.flyTo 会快速完成，不会拖 2.5s
    // ===================================
    if (scene.camera) {
      try {
        await commandBus.execute({
          name: 'camera.flyTo',
          args: {
            longitude: scene.camera.longitude,
            latitude: scene.camera.latitude,
            height: scene.camera.height,
            duration: scene.camera.duration ?? 2.5,
          },
        });
      } catch (err) {
        console.warn('[LessonRuntime] camera.flyTo rejected', err);
      }
    }
  }

  /** 获取课程数据（Q7 优化：走 static lessonCache + warmUp） */
  private async fetchLesson(lessonId: string): Promise<LessonPackage | null> {
    return LessonRuntime.fetchLessonInternal(lessonId);
  }

  /**
   * 单元测试辅助：直接注入内存中的 LessonPackage（绕过 dynamic import，避免 vitest 下 Vite import.meta.glob 依赖）
   * —— 生产代码不应调用此方法。
   */
  __testInjectLesson(lesson: LessonPackage): void {
    if (lesson.steps.length === 0) {
      throw new Error('__testInjectLesson: 空 steps');
    }
    this.currentLesson = lesson;
    this.currentStepIndex = 0;
    this.isPaused = false;
    const store = useGeographyStore.getState();
    store.setLesson({
      activeLessonId: lesson.meta.id ?? '__in_memory__',
      currentStep: 0,
      totalSteps: lesson.steps.length,
      stepTitle: lesson.steps[0].title,
      narration: lesson.steps[0].narration,
      isPaused: false,
    });
  }

  /** 获取当前步骤的问题 */
  getCurrentQuestion(): LessonStep['question'] | undefined {
    if (!this.currentLesson) return undefined;
    return this.currentLesson.steps[this.currentStepIndex]?.question;
  }
}
