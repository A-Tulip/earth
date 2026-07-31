/**
 * GeographySceneState —— 场景状态的唯一真实来源
 *
 * 独立于 UI 组件。AI、课程播放器、按钮和地图点击都只修改场景状态
 * 或向 Command Bus 发送命令，React 组件根据状态渲染。
 */

export type ViewMode = '3d' | '2d' | 'columbus';
export type BasemapType = 'satellite' | 'terrain' | 'political' | 'osm';

/** 标注图层开关集合 */
export interface AnnotationLayers {
  graticule: boolean;      // 经纬线
  cities: boolean;          // 城市
  labels: boolean;          // 地名
  climateZones: boolean;    // 气候带
  plates: boolean;          // 板块区域
  dateLine: boolean;        // 日界线
  rivers: boolean;          // 河流
  mountains: boolean;       // 山脉
  adminBounds: boolean;     // 行政边界
  oceanCurrents: boolean;   // 洋流
  monsoonWinds: boolean;    // 季风风向
}

/** 天文图层开关集合 */
export interface AstronomyLayers {
  axis: boolean;            // 地轴
  directPoint: boolean;     // 太阳直射点
  twilight: boolean;        // 晨昏线
  dayMode: boolean;         // 日间模式
  rotation: boolean;        // 自转
  revolution: boolean;      // 公转
}

/** 数据图层开关集合 */
export interface DataLayers {
  weather: boolean;
  earthquake: boolean;
  naturalEvents: boolean;
  gdp: boolean;
  population: boolean;
  temperature: boolean;
  precipitation: boolean;
}

/** 测量工具状态 */
export interface MeasurementState {
  mode: 'none' | 'distance' | 'area' | 'angle' | 'height' | 'profile';
  active: boolean;
  result: string | null;
}

/** 地形分析状态 */
export interface TerrainAnalysisState {
  contour: boolean;         // 等高线
  contourSpacing: number;   // 等高线间距（米）
  elevationRamp: boolean;   // 高程分层
  slope: boolean;           // 坡度
  aspect: boolean;          // 坡向
  exaggeration: number;     // 地形夸张倍数
}

/** 镜头状态 */
export interface CameraState {
  longitude: number;
  latitude: number;
  height: number;          // 米
  heading: number;         // 弧度
  pitch: number;           // 弧度
  isFlying: boolean;
}

/** 选中对象 */
export interface SelectedObject {
  kind: 'mountain' | 'river' | 'city' | 'plate' | 'contour' | 'airmass' | 'feature';
  id: string;
  name: string;
  position?: { lon: number; lat: number; height?: number };
}

/** 时间维度状态（仅时序课程激活） */
export interface TimeDimensionState {
  active: boolean;
  currentTime: string;      // ISO 8601
  startTime: string;
  endTime: string;
  multiplier: number;       // 时间倍速
  isPlaying: boolean;
}

/** 语音状态 */
export interface VoiceState {
  listening: boolean;       // 正在录音
  processing: boolean;      // ASR/LLM 处理中
  speaking: boolean;        // TTS 播放中
  transcript: string;       // 最终识别文本
  partialText: string;      // 实时流式识别文本（partial）
  response: string;         // AI 回复文本
  error: string | null;
  muted: boolean;
  asrStreaming: boolean;    // 是否使用流式 ASR
  asrReady: boolean;        // 流式 ASR 是否已就绪
}

/** 课程运行时状态 */
export interface LessonRuntimeState {
  activeLessonId: string | null;
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
  narration: string;        // 当前讲解文本
  isPaused: boolean;
}

/** 临时控件状态 */
export interface TransientUIState {
  showGuidance: boolean;    // 首次引导文字
  showCommandMenu: boolean; // 课程菜单
  showLecturePanel: boolean;// 讲义层
  lectureContent: string;
  showContextMenu: boolean; // 上下文操作菜单
  contextMenuActions: ContextAction[];
  showSubtitle: boolean;
}

export interface ContextAction {
  id: string;
  label: string;
  command: string;          // 对应 Command Bus 命令名
}

/** 完整场景状态 */
export interface GeographySceneState {
  // 基础视图
  viewMode: ViewMode;
  basemap: BasemapType;

  /** 太阳系视图激活（切换到 Three.js，Cesium 卸载） */
  solarSystemActive: boolean;

  // 图层
  annotations: AnnotationLayers;
  astronomy: AstronomyLayers;
  data: DataLayers;

  // 分析工具
  terrain: TerrainAnalysisState;
  measurement: MeasurementState;

  // 运行时
  camera: CameraState;
  selected: SelectedObject | null;
  time: TimeDimensionState;
  voice: VoiceState;
  lesson: LessonRuntimeState;
  ui: TransientUIState;

  // 速度
  rotationSpeed: number;
  revolutionSpeed: number;
  axisTilt: number;
  sunHeight: number;        // 太阳高度角（度）
}

export const initialSceneState: GeographySceneState = {
  viewMode: '3d',
  basemap: 'satellite',
  solarSystemActive: false,

  annotations: {
    graticule: true,
    cities: false,
    labels: true,
    climateZones: false,
    plates: false,
    dateLine: false,
    rivers: false,
    mountains: false,
    adminBounds: false,
    oceanCurrents: false,
    monsoonWinds: false,
  },

  astronomy: {
    axis: true,
    directPoint: true,
    twilight: false,
    dayMode: false,
    rotation: true,
    revolution: false,
  },

  data: {
    weather: false,
    earthquake: false,
    naturalEvents: false,
    gdp: false,
    population: false,
    temperature: false,
    precipitation: false,
  },

  terrain: {
    contour: false,
    contourSpacing: 200,
    elevationRamp: false,
    slope: false,
    aspect: false,
    exaggeration: 1.0,
  },

  measurement: {
    mode: 'none',
    active: false,
    result: null,
  },

  camera: {
    longitude: 116.4,
    latitude: 35.0,
    height: 15_000_000,
    heading: 0,
    pitch: -Math.PI / 2,
    isFlying: false,
  },

  selected: null,

  time: {
    active: false,
    currentTime: new Date().toISOString(),
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    multiplier: 1,
    isPlaying: false,
  },

  voice: {
    listening: false,
    processing: false,
    speaking: false,
    transcript: '',
    partialText: '',
    response: '',
    error: null,
    muted: false,
    asrStreaming: false,
    asrReady: false,
  },

  lesson: {
    activeLessonId: null,
    currentStep: 0,
    totalSteps: 0,
    stepTitle: '',
    narration: '',
    isPaused: false,
  },

  ui: {
    showGuidance: true,
    showCommandMenu: false,
    showLecturePanel: false,
    lectureContent: '',
    showContextMenu: false,
    contextMenuActions: [],
    showSubtitle: false,
  },

  rotationSpeed: 1.0,
  revolutionSpeed: 1.0,
  axisTilt: 23.5,
  // sunHeight = NaN 表示未手动设置，按当前日期动态计算太阳赤纬（直射点纬度）
  sunHeight: Number.NaN,
};
