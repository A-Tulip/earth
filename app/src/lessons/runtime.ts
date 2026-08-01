/**
 * LessonRuntime —— 课程播放器
 *
 * 管理课程加载、播放、暂停、恢复、推进。
 * 通过 Command Bus 执行场景操作，不直接操作 Cesium。
 */

import { LessonPackage, LessonStep } from './schema';
import { commandBus } from '../commands/bus';
import { useGeographyStore } from '../state/store';
import { tts as ttsAdapter } from './singletons';
import { findFirstMention } from './geoReferencer';

export class LessonRuntime {
  private currentLesson: LessonPackage | null = null;
  private currentStepIndex = 0;
  private isPaused = false;
  /** 旁白过程中：命中地理名词后，安排一个"多少秒后飞行"的取消令牌 */
  private narrationTimers: number[] = [];

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

  /** 播放指定步骤 */
  private async playStep(index: number): Promise<void> {
    if (!this.currentLesson || index < 0 || index >= this.currentLesson.steps.length) return;

    const step = this.currentLesson.steps[index];
    this.currentStepIndex = index;

    const store = useGeographyStore.getState();
    store.setLesson({
      currentStep: index,
      stepTitle: step.title,
      narration: step.narration,
      isPaused: false,
    });

    // 1. 执行场景配置
    await this.applySceneConfig(step);

    // 2. 显示讲义（如果有）
    if (step.lecture) {
      store.setUI({ showLecturePanel: true, lectureContent: step.lecture });
    }

    // 3. TTS 朗读旁白（命中地理名词后，延时飞行，避免一开口就跳镜头）
    this.clearNarrationTimers();
    if (step.narration) {
      const mention = findFirstMention(step.narration);
      if (mention && !step.scene?.camera) {
        // 粗估：220 字/分钟 ≈ 3.6 字/秒，命中位置在全文的比例 × 预估秒数
        const charsPerSecond = 3.6;
        const totalSec = Math.max(2, step.narration.length / charsPerSecond);
        const hitIndex = step.narration.indexOf(mention.name);
        const mentionSec =
          hitIndex >= 0 ? (hitIndex + mention.name.length / 2) / charsPerSecond : Math.min(2.5, totalSec * 0.4);
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

      if (!store.voice.muted) {
        store.setVoice({ speaking: true, response: step.narration });
        await ttsAdapter.speak(step.narration);
        store.setVoice({ speaking: false });
      }
    }

    // 4. 显示问题（如果有）
    if (step.question) {
      store.setUI({ showSubtitle: true });
      // 问题由 UI 组件渲染
    }
  }

  /** 推进到下一步 */
  async advance(): Promise<void> {
    if (!this.currentLesson) return;
    const next = this.currentStepIndex + 1;
    if (next < this.currentLesson.steps.length) {
      await this.playStep(next);
    } else {
      // 课程结束
      const store = useGeographyStore.getState();
      store.setLesson({
        activeLessonId: null,
        currentStep: 0,
        totalSteps: 0,
        stepTitle: '',
        narration: '',
        isPaused: false,
      });
      store.setUI({ showLecturePanel: false, lectureContent: '' });
    }
  }

  /** 暂停 */
  pause(): void {
    this.isPaused = true;
    ttsAdapter.stop();
    useGeographyStore.getState().setLesson({ isPaused: true });
  }

  /** 恢复 */
  resume(): void {
    this.isPaused = false;
    useGeographyStore.getState().setLesson({ isPaused: false });
  }

  /** 重置 */
  async reset(): Promise<void> {
    if (!this.currentLesson) return;
    this.currentStepIndex = 0;
    this.isPaused = false;
    await this.playStep(0);
  }

  /** 打断当前旁白（用户开始说话时调用） */
  interrupt(): void {
    ttsAdapter.stop();
    this.clearNarrationTimers();
    this.pause();
  }

  private clearNarrationTimers(): void {
    for (const id of this.narrationTimers) window.clearTimeout(id);
    this.narrationTimers.length = 0;
  }

  /** 应用场景配置 */
  private async applySceneConfig(step: LessonStep): Promise<void> {
    const scene = step.scene;

    // 镜头飞行
    if (scene.camera) {
      await commandBus.execute({
        name: 'camera.flyTo',
        args: {
          longitude: scene.camera.longitude,
          latitude: scene.camera.latitude,
          height: scene.camera.height,
          duration: scene.camera.duration ?? 2.5,
        },
      });
    }

    // 视图模式
    if (scene.viewMode) {
      await commandBus.execute({ name: 'view.setMode', args: { mode: scene.viewMode } });
    }

    // 底图
    if (scene.basemap) {
      await commandBus.execute({ name: 'view.setBasemap', args: { basemap: scene.basemap } });
    }

    // 等高线
    if (scene.contour) {
      await commandBus.execute({
        name: 'layer.showContour',
        args: { spacing: scene.contour.spacing },
      });
    }

    // 地形夸张
    if (scene.exaggeration) {
      await commandBus.execute({
        name: 'terrain.setExaggeration',
        args: { value: scene.exaggeration },
      });
    }

    // 高程分层
    if (scene.layers?.terrain?.elevationRamp) {
      await commandBus.execute({ name: 'layer.showElevationRamp', args: {} });
    }

    // 图层开关
    if (scene.layers?.annotations) {
      for (const [layer, visible] of Object.entries(scene.layers.annotations)) {
        await commandBus.execute({
          name: 'layer.toggle',
          args: { layer, visible },
        });
      }
    }
    if (scene.layers?.astronomy) {
      for (const [layer, visible] of Object.entries(scene.layers.astronomy)) {
        await commandBus.execute({
          name: 'layer.toggle',
          args: { layer, visible },
        });
      }
    }
    if (scene.layers?.data) {
      for (const [layer, visible] of Object.entries(scene.layers.data)) {
        await commandBus.execute({
          name: 'layer.toggle',
          args: { layer, visible },
        });
      }
    }

    // 时间动画：同步到 store.time，由 CesiumCanvas 订阅驱动 Cesium 时钟
    if (scene.timeAnimation) {
      const ta = scene.timeAnimation;
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
      // 非时序步骤：关闭时间维度
      const cur = useGeographyStore.getState().time;
      useGeographyStore.getState().patch({
        time: { ...cur, active: false, isPlaying: false },
      });
    }
  }

  /** 获取课程数据 */
  private async fetchLesson(lessonId: string): Promise<LessonPackage | null> {
    // 开发阶段直接 import；生产阶段可从 API 加载
    try {
      const module = await import(`@content/${lessonId}/lesson.ts`);
      return module.default as LessonPackage;
    } catch {
      console.error(`课程 ${lessonId} 加载失败`);
      return null;
    }
  }

  /** 获取当前步骤的问题 */
  getCurrentQuestion(): LessonStep['question'] | undefined {
    if (!this.currentLesson) return undefined;
    return this.currentLesson.steps[this.currentStepIndex]?.question;
  }
}
