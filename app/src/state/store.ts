/**
 * Geography Store —— Zustand 状态管理
 *
 * 所有状态变更的唯一入口。Command Bus 的 handler 通过此 store 修改状态。
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  GeographySceneState,
  initialSceneState,
  AnnotationLayers,
  AstronomyLayers,
  DataLayers,
  TerrainAnalysisState,
  CameraState,
  SelectedObject,
  VoiceState,
  LessonRuntimeState,
  TransientUIState,
  ViewMode,
  BasemapType,
} from './sceneState';

interface GeographyStore extends GeographySceneState {
  // 批量更新
  patch: (partial: Partial<GeographySceneState>) => void;

  // 细粒度更新
  setViewMode: (mode: ViewMode) => void;
  setBasemap: (basemap: BasemapType) => void;
  setSolarSystemActive: (active: boolean) => void;

  toggleAnnotation: (key: keyof AnnotationLayers, value?: boolean) => void;
  toggleAstronomy: (key: keyof AstronomyLayers, value?: boolean) => void;
  toggleData: (key: keyof DataLayers, value?: boolean) => void;

  setTerrain: (partial: Partial<TerrainAnalysisState>) => void;
  setMeasurement: (partial: Partial<GeographySceneState['measurement']>) => void;

  setCamera: (partial: Partial<CameraState>) => void;
  setSelected: (obj: SelectedObject | null) => void;

  setVoice: (partial: Partial<VoiceState>) => void;
  setLesson: (partial: Partial<LessonRuntimeState>) => void;
  setUI: (partial: Partial<TransientUIState>) => void;

  // 速度参数
  setRotationSpeed: (v: number) => void;
  setRevolutionSpeed: (v: number) => void;
  setAxisTilt: (v: number) => void;
  setSunHeight: (v: number) => void;

  // 重置
  reset: () => void;
}

export const useGeographyStore = create<GeographyStore>()(
  subscribeWithSelector((set) => ({
  ...initialSceneState,

  patch: (partial) => set(partial),

  setViewMode: (mode) => set({ viewMode: mode }),
  setBasemap: (basemap) => set({ basemap }),
  setSolarSystemActive: (active) => set({ solarSystemActive: active }),

  toggleAnnotation: (key, value) =>
    set((s) => ({
      annotations: {
        ...s.annotations,
        [key]: value ?? !s.annotations[key],
      },
    })),

  toggleAstronomy: (key, value) =>
    set((s) => ({
      astronomy: {
        ...s.astronomy,
        [key]: value ?? !s.astronomy[key],
      },
    })),

  toggleData: (key, value) =>
    set((s) => ({
      data: {
        ...s.data,
        [key]: value ?? !s.data[key],
      },
    })),

  setTerrain: (partial) =>
    set((s) => ({ terrain: { ...s.terrain, ...partial } })),

  setMeasurement: (partial) =>
    set((s) => ({ measurement: { ...s.measurement, ...partial } })),

  setCamera: (partial) =>
    set((s) => ({ camera: { ...s.camera, ...partial } })),

  setSelected: (obj) => set({ selected: obj }),

  setVoice: (partial) =>
    set((s) => ({ voice: { ...s.voice, ...partial } })),

  setLesson: (partial) =>
    set((s) => ({ lesson: { ...s.lesson, ...partial } })),

  setUI: (partial) =>
    set((s) => ({ ui: { ...s.ui, ...partial } })),

  setRotationSpeed: (v) => set({ rotationSpeed: v }),
  setRevolutionSpeed: (v) => set({ revolutionSpeed: v }),
  setAxisTilt: (v) => set({ axisTilt: v }),
  setSunHeight: (v) => set({ sunHeight: v }),

  reset: () => set(initialSceneState),
})),
);
