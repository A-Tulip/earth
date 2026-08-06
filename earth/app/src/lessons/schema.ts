/**
 * Lesson Schema —— 课程内容结构定义
 *
 * 每个课程包包含：课程正文、场景配置、旁白、问题、空间区域、动画、来源
 */

export type LessonLevel = 'junior' | 'senior';
export type LessonCategory = 'natural' | 'human' | 'regional' | 'earth-map';

/** 课程元数据 */
export interface LessonMeta {
  id: string;
  level: LessonLevel;
  category: LessonCategory;
  title: string;
  description: string;
  tags: string[];
  grade: string;          // 适用年级，如 "八年级"
  objectives: string[];   // 教学目标
  duration: number;       // 预计时长（分钟）
  references: string[];   // 参考资料
  curriculumStandard: string; // 课标引用
}

/** 课程步骤 */
export interface LessonStep {
  id: string;
  title: string;
  /** 旁白文本（不强制必填：如果留空但提供了 aiPrompt，则进入步骤时调用 LLM 动态生成旁白） */
  narration?: string;
  /** 详细讲义（Markdown，可选） */
  lecture?: string;
  /**
   * ✅ ISSUE-6：支持 AI 动态生成课程内容（不写死）
   * - 如果 narration 为空或省略，但 aiPrompt 存在 → 进入本步时调用 LLM，
   *   把 aiPrompt + 当前课程标题/目标/场景 拼接成系统提示，由 LLM 生成 1-2 句中文旁白。
   * - 示例：aiPrompt = "请面向七年级学生，解释为什么山谷风在白天从山谷吹向山顶？"
   */
  aiPrompt?: string;
  /** 场景配置 */
  scene: LessonSceneConfig;
  /** 问题（可选） */
  question?: LessonQuestion;
}

/** 区域叠加：在地球上绘制一个半透明多边形区域（用于三级阶梯、板块、气候带等教学高亮） */
export interface RegionOverlay {
  /** 唯一 id（同一课程内建议唯一） */
  id: string;
  /** 显示名称（中文，渲染在区域上方） */
  name: string;
  /** 十六进制颜色，如 '#f54e00'；缺省按 index 自动取教学色板 */
  color?: string;
  /** 多边形边界经纬度 [lon, lat][]
   *
   * 注意：多边形闭合由 Cesium 处理（首尾自动闭合），这里只需按顺序给出顶点。
   * 顶点顺序为逆时针（右手系卷绕），否则多边形会被判为"反卷绕"而显示异常。
   */
  coordinates: Array<[number, number]>;
}

/** 场景配置 */
export interface LessonSceneConfig {
  camera?: {
    longitude: number;
    latitude: number;
    height: number;
    duration?: number;
  };
  viewMode?: '2d' | '3d' | 'columbus';
  basemap?: import('../state/sceneState').BasemapType;
  /** 区域叠加（进入本步时绘制，无 regions 的步骤自动清除上一区域的叠加） */
  regions?: RegionOverlay[];
  /** 图层状态 */
  layers?: {
    annotations?: Partial<Record<string, boolean>>;
    astronomy?: Partial<Record<string, boolean>>;
    data?: Partial<Record<string, boolean>>;
    terrain?: Partial<Record<string, boolean | number>>;
  };
  /** 等高线配置 */
  contour?: { spacing: number };
  /** 地形夸张 */
  exaggeration?: number;
  /** GeoJSON 区域文件路径 */
  regionFile?: string;
  /** 时间动画配置（仅时序课程） */
  timeAnimation?: {
    startTime: string;
    endTime: string;
    multiplier: number;
  };
}

/** 问题 */
export interface LessonQuestion {
  id: string;
  type: 'choice' | 'short-answer' | 'map-click';
  question: string;
  options?: string[];      // 选择题选项
  answer: string | string[]; // 正确答案
  explanation: string;
  /** 地图点击题的期望区域 */
  expectedRegion?: {
    minLon: number; maxLon: number;
    minLat: number; maxLat: number;
  };
}

/** 完整课程包 */
export interface LessonPackage {
  meta: LessonMeta;
  steps: LessonStep[];
}
