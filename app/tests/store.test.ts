/**
 * 课程状态机 + GeographySceneState 单元测试
 *
 * 验证：状态独立于 UI、图层切换、地形分析状态、课程运行时状态
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGeographyStore } from '../src/state/store';
import { initialSceneState } from '../src/state/sceneState';

describe('GeographySceneState 初始状态', () => {
  it('默认视图为 3D，底图为 satellite', () => {
    const state = useGeographyStore.getState();
    expect(state.viewMode).toBe('3d');
    expect(state.basemap).toBe('satellite');
  });

  it('默认开启经纬线、地名、地轴、太阳直射点、自转；晨昏线默认关闭', () => {
    const state = useGeographyStore.getState();
    expect(state.annotations.graticule).toBe(true);
    expect(state.annotations.labels).toBe(true);
    expect(state.astronomy.axis).toBe(true);
    expect(state.astronomy.directPoint).toBe(true);
    expect(state.astronomy.twilight).toBe(false);
    expect(state.astronomy.rotation).toBe(true);
  });

  it('默认关闭课程、时间维度、测量', () => {
    const state = useGeographyStore.getState();
    expect(state.lesson.activeLessonId).toBeNull();
    expect(state.time.active).toBe(false);
    expect(state.measurement.active).toBe(false);
  });

  it('初始镜头位于中国上空', () => {
    const state = useGeographyStore.getState();
    expect(state.camera.longitude).toBeCloseTo(116.4);
    expect(state.camera.latitude).toBeCloseTo(35.0);
    expect(state.camera.height).toBe(15_000_000);
  });
});

describe('状态更新', () => {
  beforeEach(() => {
    useGeographyStore.getState().reset();
  });

  it('toggleAnnotation 切换图层状态', () => {
    const store = useGeographyStore.getState();
    expect(store.annotations.cities).toBe(false);
    store.toggleAnnotation('cities');
    expect(useGeographyStore.getState().annotations.cities).toBe(true);
    store.toggleAnnotation('cities');
    expect(useGeographyStore.getState().annotations.cities).toBe(false);
  });

  it('toggleAnnotation 显式设置 value', () => {
    useGeographyStore.getState().toggleAnnotation('rivers', true);
    expect(useGeographyStore.getState().annotations.rivers).toBe(true);
    useGeographyStore.getState().toggleAnnotation('rivers', true);
    expect(useGeographyStore.getState().annotations.rivers).toBe(true);
  });

  it('setTerrain 更新地形分析状态', () => {
    useGeographyStore.getState().setTerrain({ contour: true, contourSpacing: 100 });
    const state = useGeographyStore.getState();
    expect(state.terrain.contour).toBe(true);
    expect(state.terrain.contourSpacing).toBe(100);
  });

  it('setViewMode 切换视图模式', () => {
    useGeographyStore.getState().setViewMode('2d');
    expect(useGeographyStore.getState().viewMode).toBe('2d');
    useGeographyStore.getState().setViewMode('3d');
    expect(useGeographyStore.getState().viewMode).toBe('3d');
  });

  it('setLesson 更新课程运行时状态', () => {
    useGeographyStore.getState().setLesson({
      activeLessonId: 'contour-lines',
      currentStep: 1,
      totalSteps: 7,
      stepTitle: '等高线疏密',
      narration: '测试旁白',
      isPaused: false,
    });
    const state = useGeographyStore.getState();
    expect(state.lesson.activeLessonId).toBe('contour-lines');
    expect(state.lesson.currentStep).toBe(1);
    expect(state.lesson.stepTitle).toBe('等高线疏密');
  });

  it('setVoice 更新语音状态', () => {
    useGeographyStore.getState().setVoice({ listening: true, transcript: '打开等高线' });
    const state = useGeographyStore.getState();
    expect(state.voice.listening).toBe(true);
    expect(state.voice.transcript).toBe('打开等高线');
  });

  it('reset 恢复初始状态', () => {
    useGeographyStore.getState().toggleAnnotation('cities');
    useGeographyStore.getState().setViewMode('2d');
    useGeographyStore.getState().reset();
    const state = useGeographyStore.getState();
    expect(state.annotations.cities).toBe(initialSceneState.annotations.cities);
    expect(state.viewMode).toBe(initialSceneState.viewMode);
  });

  it('时间维度默认不激活（仅时序课程激活）', () => {
    expect(useGeographyStore.getState().time.active).toBe(false);
    useGeographyStore.getState().patch({
      time: { ...useGeographyStore.getState().time, active: true, isPlaying: true },
    });
    expect(useGeographyStore.getState().time.active).toBe(true);
    expect(useGeographyStore.getState().time.isPlaying).toBe(true);
  });
});
