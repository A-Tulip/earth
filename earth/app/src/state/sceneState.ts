/**
 * GeographySceneState —— 场景状态的唯一真实来源
 *
 * 独立于 UI 组件。AI、课程播放器、按钮和地图点击都只修改场景状态
 * 或向 Command Bus 发送命令，React 组件根据状态渲染。
 */

export type ViewMode = '3d' | '2d' | 'columbus';
/**
 * §1.2 扩展为 13 种语义（含 terrain 历史别名，向后兼容）
 * - political/relief/landform/satellite 默认叠加天地图中文注记
 * - contour：政区底图 + 叠加等高线材质（globe.material=ElevationContour）
 * - osm：开放街道图（不叠中文注记，纯英文）
 * - amapSatellite / amapPolitical / amapRoad：高德瓦片（卫星/路网+注记/纯路网）
 * - tiandituSatellite / tiandituPolitical / tiandituRelief：天地图显式瓦片（有 VITE_TIANDITU_TOKEN 时可用，确保中文注记+国内坐标）
 * - terrain：历史别名 → 内部映射为 relief
 */
export type BasemapType =
  | 'satellite'
  | 'political'
  | 'relief'
  | 'landform'
  | 'contour'
  | 'osm'
  | 'amapSatellite'
  | 'amapPolitical'
  | 'amapRoad'
  | 'tiandituSatellite'
  | 'tiandituPolitical'
  | 'tiandituRelief'
  | 'terrain';

/**
 * 历史别名 'terrain' 的解析映射（任何入口都先跑这个）
 */
export function normalizeBasemap(bm: BasemapType): Exclude<BasemapType, 'terrain'> {
  return bm === 'terrain' ? 'relief' : bm;
}

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
  available: boolean;       // 是否有真实地形数据（椭球时为 false，地形分析功能不可用）
  googleEarth: boolean;     // Google Earth 真实感 3D Tiles
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
  realtimeChatActive: boolean;  // 实时对话模式（全双工，VAD 自动检测）
}

/** 课程运行时状态 */
export interface LessonRuntimeState {
  activeLessonId: string | null;
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
  narration: string;        // 当前讲解文本
  isPaused: boolean;
  finished?: boolean;       // 是否走到最后一步（自然结束后仍可回看/退出）
}

/** API 限流提示状态 */
export interface ApiRateLimitStatus {
  /** 是否处于限流状态（429/错误静默期） */
  active: boolean;
  /** 受限的数据源 ID（weather / earthquake / natural-events / temperature / precipitation） */
  provider?: string;
  /** 原因说明 */
  reason?: string;
  /** 剩余秒数 */
  remainingSeconds?: number;
}

/** 临时控件状态 */
export type LayerErrorKind = 'basemap' | 'terrain' | 'sceneMode' | 'annotation' | 'data' | 'globeMaterial' | 'lessons' | 'ai' | 'unknown';
export type LayerErrorCategory = 'network' | 'not_found' | 'invalid_args' | 'auth' | 'render' | 'timeout' | 'rate_limit' | 'unknown';

/** Q9 AI 对话消息 */
export type AIChatRole = 'user' | 'assistant' | 'system';
export interface AIToolCallVisual {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}
export interface AIChatMessage {
  id: string;
  role: AIChatRole;
  /** 文本内容；assistant 的文本可以在 toolCalls 之前/之后出现 */
  content: string;
  createdAt: string;
  /** AI 工具调用（用于显示可视化反馈） */
  toolCalls?: AIToolCallVisual[];
  /** 这段消息是否已经完成渲染（false=还在流式输出） */
  done?: boolean;
  /** 如果本消息因错误终止，保留错误描述 */
  errorMessage?: string | null;
}

export interface TransientUIState {
  showGuidance: boolean;    // 首次引导文字
  showCommandMenu: boolean; // 课程菜单
  showLecturePanel: boolean;// 讲义层
  lectureContent: string;
  showContextMenu: boolean; // 上下文操作菜单
  contextMenuActions: ContextAction[];
  showSubtitle: boolean;
  /** Q9：是否显示 AI 对话侧栏面板 */
  showAIChat: boolean;
  /** Q9：AI 对话历史，跨面板打开/关闭保留在 state 里（避免"点关闭就丢聊天记录"） */
  aiChatHistory: AIChatMessage[];
  /** Q9：AI 是否正在生成中（用于输入框禁用 / 发送按钮 loading） */
  aiChatGenerating: boolean;
  /** Q4 QuestionCard：用户最近一次提交的答案 */
  lastUserAnswer?: string | null;
  /** Q4 QuestionCard：最近一次判题结果（对错+解析） */
  lastQuestionResult?: { correct: boolean; explanation?: string } | null;
  /** API 限流提示（issue #18） */
  rateLimit: ApiRateLimitStatus;
  /** §0.2 Manager 最近一次图层切换错误，用于 Toast 显示，null/undefined 表示无错 */
  lastLayerError?: string | null;
  /** §0.2 lastLayerError 写入时间（ISO8601），UI 侧按此字段变化触发 Toast */
  lastLayerErrorAt?: string | null;
  /** Q1：错误分类（网络/资源不存在/参数错误/认证/渲染/超时/限流）—— 帮助用户理解和决定下一步 */
  lastLayerErrorCategory?: LayerErrorCategory | null;
  /** Q1：错误所属图层类别（basemap/terrain/sceneMode...） */
  lastLayerErrorKind?: LayerErrorKind | null;
  /** Q1：重试建议动作（CommandBus 的 name + args 对），若存在则显示"重试"按钮，点击执行 */
  lastLayerErrorRetryAction?: { name: string; args: Record<string, unknown> } | null;
  /**
   * Q2 加载动画：LayerLifeCycleManager 每次调度会把对应 kind → true，结束后 false
   * LoadingOverlay 组件读取此字段显示叠加层，避免"蓝色底图裸露"的瞬间
   */
  layerBusy: Partial<Record<
    'basemap' | 'terrain' | 'sceneMode' | 'annotation' | 'data' | 'globeMaterial',
    boolean
  >>;
  /**
   * Q6 启动加载进度（0-100，整数）：
   *   - 0    : 页面刚打开，还没开始初始化 Cesium
   *   - 1~99 : 分步推进（Cesium 初始化 / 底图首瓦片 / 地形首帧 / 单例就绪 / 首次渲染）
   *   - 100  : 全部就绪，AppLoader 开始淡出
   */
  startupProgress: number;
  /** Q6 启动加载阶段的文案（显示在百分比下方，给用户一个"此刻在做什么"的预期） */
  startupLabel: string | null;
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
  // 默认 satellite（单元测试一致基线）；若存在 VITE_AMAP_KEY，CesiumCanvas 启动时会切换为 amapSatellite
  basemap: 'satellite',
  solarSystemActive: false,

  annotations: {
    graticule: false,
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
    // 地轴、晨昏线、公转默认关闭，需通过 UI 明确开启
    axis: false,
    directPoint: false,
    twilight: false,
    dayMode: false,
    // 用户需求：初始界面地球符合地理知识自西向东自转
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
    contourSpacing: 500,
    elevationRamp: false,
    slope: false,
    aspect: false,
    exaggeration: 1.0,
    available: false, // 初始为 false，CesiumCanvas 加载真实地形后设为 true
    googleEarth: false,
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
    realtimeChatActive: false,  // 实时对话模式默认关闭，需用户主动开启
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
    showAIChat: false,
    aiChatHistory: [],
    aiChatGenerating: false,
    lastUserAnswer: null,
    lastQuestionResult: null,
    rateLimit: { active: false },
    lastLayerError: null,
    lastLayerErrorAt: null,
    lastLayerErrorCategory: null,
    lastLayerErrorKind: null,
    lastLayerErrorRetryAction: null,
    layerBusy: {},
    startupProgress: 0,
    startupLabel: '正在启动…',
  },

  rotationSpeed: 1.0,
  revolutionSpeed: 1.0,
  axisTilt: 23.5,
  // sunHeight = NaN 表示未手动设置，按当前日期动态计算太阳赤纬（直射点纬度）
  sunHeight: Number.NaN,
};
