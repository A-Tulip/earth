/**
 * LessonRuntime 状态机单元测试
 *
 * 验证：
 *  1. load (inject) → start → nextStep → prevStep → replayStep → pause/resume → close
 *  2. 有题的步骤不自动推进（暂停，等学生回答）
 *  3. 最后一步进入 finished 状态，不再抛错
 *  4. 静音模式下旁白按字数估算字幕停留时间（异步等待，但自动推进会被 nextStep/prevStep 主动取消）
 *  5. 关闭课程清除课程/讲义/字幕/语音状态
 *
 * 注：不调用 Cesium 真实 viewer（通过 bus 注入 mock cesium controller）；
 *     不 dynamic import 真实课程文件（用 __testInjectLesson 注入内存课程包）；
 *     不调用真实 TTS（voice.muted=true 让 speakPromise 走"静音等待估算时间"分支）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LessonRuntime } from '../src/lessons/runtime';
import { useGeographyStore } from '../src/state/store';
import { commandBus, registerCommandHandlers } from '../src/commands/bus';
import type { LessonPackage, LessonStep } from '../src/lessons/schema';
import type { LLMAdapter, LLMMessage } from '../src/voice/adapters';

/** 创建 mock CesiumController（与 commandBus.test.ts 保持一致） */
function createMockCesiumController(): unknown {
  const noop = async () => {
    /* noop */
  };
  const noopSync = () => {
    /* noop sync */
  };
  return {
    getViewer: () => ({ camera: { position: {} } }),
    flyTo: noop,
    resetView: noop,
    setSceneMode: noop,
    setBasemap: noop,
    showContour: noop,
    showElevationRamp: noop,
    showSlope: noop,
    showAspect: noop,
    clearTerrainMaterial: noop,
    highlightRegions: noop,
    clearRegions: noop,
    setTerrainExaggeration: noop,
    startMeasurement: noop,
    clearMeasurement: noop,
    showSolarSystem: noop,
    showEarth: noop,
    toggleAnnotation: noop,
    updateLayer: noop,
    setAxisTilt: noopSync,
    setSunHeight: noopSync,
    setRotation: noopSync,
    addPointAnnotation: noop,
    clearAllAnnotations: noop,
  };
}

/** 构造一个最小可用的多步骤 LessonPackage */
function buildSampleLesson(): LessonPackage {
  const steps: LessonStep[] = [
    {
      id: 'intro',
      title: '课程导入',
      narration: '欢迎来到等高线地形课。我们先从喜马拉雅山脉看起。',
      scene: {
        camera: { longitude: 86.9, latitude: 27.99, height: 1_500_000, duration: 0.1 },
        basemap: 'terrain',
      },
    },
    {
      id: 'dense',
      title: '等高线疏密',
      narration: '等高线越密，坡度越陡。这里我们看珠穆朗玛峰附近的等高线。',
      scene: {
        camera: { longitude: 86.925, latitude: 27.9881, height: 200_000, duration: 0.1 },
        contour: { spacing: 100 },
        exaggeration: 5,
      },
    },
    {
      id: 'valley',
      title: '山谷与山脊',
      narration: '等高线凸出方向指向海拔高处为山谷，指向海拔低处为山脊。',
      scene: {
        camera: { longitude: 86.93, latitude: 27.99, height: 80_000, duration: 0.1 },
      },
      question: {
        id: 'q1',
        type: 'choice',
        question: '等高线凸向高海拔表示：',
        options: ['山脊', '山谷', '鞍部', '陡崖'],
        answer: '山谷',
        explanation: '凸高为谷：水流线与等高线垂直相交，凸向高海拔一侧的是山谷。',
      },
    },
    {
      id: 'closing',
      title: '小结',
      narration: '这节课我们学习了等高线疏密、山谷与山脊的判别方法，同学们再见。',
      scene: {
        camera: { longitude: 116.4, latitude: 35, height: 15_000_000, duration: 0.1 },
      },
    },
  ];
  return {
    meta: {
      id: 'contour-lines-mock',
      level: 'junior',
      category: 'earth-map',
      title: '等高线与地形图',
      description: '初中地理：等高线判读',
      tags: ['等高线', '地形', '初中'],
      grade: '七年级',
      objectives: ['会读等高线疏密', '会判别山谷山脊'],
      duration: 8,
      references: [],
      curriculumStandard: '义务教育地理课程标准 2022',
    },
    steps,
  };
}

describe('LessonRuntime 状态机', () => {
  /**
   * setTimeout 策略：
   *  - LessonRuntime 静音分支 await setTimeout(res, narrationMs) → 文字/3*1000 ≈ 好几秒 → 压到 1ms
   *  - autoAdvanceTimer（600ms/800ms/2500ms）→ preserve 真实 delay，避免"start 一完立即 nextStep"的状态混乱
   *  - 地理名词延时飞行 delayMs（500ms ~ 15s）→ 压到 1ms（测试不关心精确"提到地点后多久飞"）
   * 规则： delay > 1500ms → 1ms；其他 preserve
   */
  let realSetTimeout: typeof globalThis.setTimeout;
  let realClearTimeout: typeof globalThis.clearTimeout;
  const pendingMap = new Map<number, { real: boolean; realId?: ReturnType<typeof setTimeout>; cb: Function; cleared: boolean }>();
  let nextId = 1;

  beforeEach(() => {
    useGeographyStore.getState().reset();
    // 打开静音模式，避免调用真实 TTS
    useGeographyStore.getState().patch({
      voice: { ...useGeographyStore.getState().voice, muted: true },
    });
    registerCommandHandlers();
    commandBus.setContext({ cesium: createMockCesiumController() as never });

    realSetTimeout = globalThis.setTimeout;
    realClearTimeout = globalThis.clearTimeout;
    pendingMap.clear();
    nextId = 1;
    globalThis.setTimeout = ((cb: unknown, delay: unknown, ...rest: unknown[]) => {
      if (typeof cb !== 'function') return realSetTimeout(cb as never, delay as never, ...rest);
      const d = typeof delay === 'number' ? delay : 0;
      const squashed = d > 1500;
      const id = nextId++;
      const entry: { real: boolean; realId?: ReturnType<typeof setTimeout>; cb: Function; cleared: boolean } = { real: !squashed, cb, cleared: false, realId: undefined };
      pendingMap.set(id, entry);
      if (squashed) {
        // 1ms 后触发（仍真实经 realSetTimeout，避免事件循环乱序）
        entry.realId = realSetTimeout(() => {
          if (!entry.cleared) {
            try { entry.cb(); } catch { /* swallow */ }
          }
          pendingMap.delete(id);
        }, 1);
      } else {
        entry.realId = realSetTimeout(() => {
          if (!entry.cleared) {
            try { entry.cb(); } catch { /* swallow */ }
          }
          pendingMap.delete(id);
        }, d, ...(rest as []));
      }
      return id;
    }) as never;
    globalThis.clearTimeout = ((id: unknown) => {
      if (typeof id === 'number') {
        const e = pendingMap.get(id);
        if (e) {
          e.cleared = true;
          if (e.realId != null) realClearTimeout(e.realId);
          pendingMap.delete(id);
          return;
        }
      }
      return realClearTimeout(id as never);
    }) as never;
  });

  afterEach(() => {
    // 回收可能残留的定时器
    for (const e of pendingMap.values()) {
      if (!e.cleared && e.realId != null) realClearTimeout(e.realId);
    }
    pendingMap.clear();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  it('注入内存课程后 load 状态写入 store：activeLessonId / totalSteps / step 0', () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    const s = useGeographyStore.getState();
    expect(s.lesson.activeLessonId).toBe('contour-lines-mock');
    expect(s.lesson.totalSteps).toBe(4);
    expect(s.lesson.currentStep).toBe(0);
    expect(s.lesson.stepTitle).toBe('课程导入');
    expect(s.basemap).toBe('satellite'); // 未 start 之前，basemap 仍是默认
  });

  it('start 后立即写字幕 + 讲义占位（静音 muted，不调真实 TTS）', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    const s = useGeographyStore.getState();
    // 进入步骤 0 立即同步写入字幕（playStep 开头的同步代码，不依赖异步）
    expect(s.ui.showSubtitle).toBe(true);
    expect(s.voice.response).toContain('欢迎来到等高线地形课');
    expect(s.lesson.currentStep).toBe(0);
    // scene.basemap='terrain' 被 applySceneConfig 写入 → Promise.race(scenePromise, 500ms) 在 fake timers 需要手动推进
    // 这里只验证：静音模式下 speaking 不会开启（voice.muted=true 分支）
    expect(s.voice.speaking).toBe(false);
  });

  it('nextStep 推进到 step1；scene.contour=true，basemap 切换 terrain（applySceneConfig 执行）', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    await rt.nextStep();
    const s = useGeographyStore.getState();
    expect(s.lesson.currentStep).toBe(1);
    expect(s.lesson.stepTitle).toBe('等高线疏密');
    // applySceneConfig 对 step 1 → layer.showContour spacing=100 → terrain.contour=true, contourSpacing=100
    expect(s.terrain.contour).toBe(true);
    expect(s.terrain.contourSpacing).toBe(100);
    expect(s.terrain.exaggeration).toBe(5);
  });

  it('prevStep 回退到上一步；第 0 步再 prevStep 抛错误', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    await rt.nextStep();
    expect(useGeographyStore.getState().lesson.currentStep).toBe(1);
    await rt.prevStep();
    expect(useGeographyStore.getState().lesson.currentStep).toBe(0);
    await expect(rt.prevStep()).rejects.toThrow(/已经是第一步/);
  });

  it('replayStep 不改变 currentStep 但会重写字幕/步骤 title', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    await rt.nextStep();
    // 模拟用户把字幕擦了（replayStep 应重写）
    useGeographyStore.getState().setUI({ showSubtitle: false });
    useGeographyStore.getState().setVoice({ response: '' });
    await rt.replayStep();
    const s = useGeographyStore.getState();
    expect(s.lesson.currentStep).toBe(1);
    expect(s.lesson.stepTitle).toBe('等高线疏密');
    expect(s.ui.showSubtitle).toBe(true);
    expect(s.voice.response).toContain('坡度越陡');
  });

  it('有题的 step (step 2) 不触发自动推进：currentStep 仍为 2', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    await rt.nextStep();
    await rt.nextStep();
    const s = useGeographyStore.getState();
    expect(s.lesson.currentStep).toBe(2);
    expect(s.lesson.stepTitle).toBe('山谷与山脊');
    // 关键验证：playStep L228: if (!this.isPaused && !step.question) { schedule autoAdvance }
    // 有 question → 不 schedule → setTimeout 即使被 nextTick 立即 resolve 也不会触发 → step 仍为 2
    // 这里我们显式再跑一轮微任务，保证不会有人偷偷排了一个 auto-advance
    await new Promise<void>((r) => setTimeout(() => r(), 0));
    expect(useGeographyStore.getState().lesson.currentStep).toBe(2);
    // getCurrentQuestion 返回当前 question
    const q = rt.getCurrentQuestion();
    expect(q?.id).toBe('q1');
    expect(q?.options).toHaveLength(4);
  });

  it('最后一步 nextStep 不抛错，进入 finished 状态', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    await rt.nextStep();
    await rt.nextStep();
    await rt.nextStep(); // 最后一步 step 3
    // 再 nextStep → finished 保护（不抛错，写入 finished:true）
    await rt.nextStep();
    const s = useGeographyStore.getState();
    expect(s.lesson.finished).toBe(true);
    expect(s.lesson.stepTitle).toBe('课程已结束');
    expect(s.lesson.isPaused).toBe(true);
  });

  it('pause / resume 切换 isPaused 状态', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    rt.pause();
    expect(useGeographyStore.getState().lesson.isPaused).toBe(true);
    rt.resume();
    expect(useGeographyStore.getState().lesson.isPaused).toBe(false);
  });

  it('close() 清理 activeLessonId + 讲义 + 字幕 + 语音 speaking', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    await rt.start();
    // 先写入一些东西，验证 close 会清理
    useGeographyStore.getState().setUI({
      showLecturePanel: true,
      lectureContent: '# 讲义',
      showSubtitle: true,
    });
    useGeographyStore.getState().setVoice({ speaking: true, response: 'x' });
    rt.close();
    const s = useGeographyStore.getState();
    expect(s.lesson.activeLessonId).toBeNull();
    expect(s.lesson.totalSteps).toBe(0);
    expect(s.lesson.finished).toBe(false);
    expect(s.ui.showLecturePanel).toBe(false);
    expect(s.ui.lectureContent).toBe('');
    expect(s.ui.showSubtitle).toBe(false);
    expect(s.voice.speaking).toBe(false);
    expect(s.voice.response).toBe('');
  });

  it('askAI：注入 LLM 后返回 AI 解释，并携带当前课程上下文', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    const mockLlm: LLMAdapter = {
      chat: vi.fn(async (messages: LLMMessage[]) => {
        // 校验系统提示里确实带了课程标题与当前步骤上下文
        const sys = messages.find((m: LLMMessage) => m.role === 'system')?.content ?? '';
        expect(sys).toContain('等高线与地形图');
        expect(sys).toContain('课程导入');
        expect(messages.find((m: LLMMessage) => m.role === 'user')?.content).toBe('为什么山谷比山脊危险？');
        return { text: '因为山谷是水流汇集之地，洪涝风险更高。' };
      }),
    };
    rt.setLLMAdapter(mockLlm);
    const answer = await rt.askAI('为什么山谷比山脊危险？');
    expect(answer).toContain('山谷');
    expect(mockLlm.chat).toHaveBeenCalledTimes(1);
  });

  it('askAI：未注入 LLM 时返回静态降级提示，不抛异常', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    const answer = await rt.askAI('解释一下这一步');
    expect(answer).toContain('离线模式');
  });

  it('askAI：LLM 抛错时返回友好错误，不中断课堂', async () => {
    const rt = new LessonRuntime();
    rt.__testInjectLesson(buildSampleLesson());
    const failingLlm: LLMAdapter = {
      chat: vi.fn(async () => {
        throw new Error('backend down');
      }),
    };
    rt.setLLMAdapter(failingLlm);
    const answer = await rt.askAI('解释一下这一步');
    expect(answer).toContain('AI 服务暂不可用');
  });
});
