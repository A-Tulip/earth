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
  narration: string;           // 旁白文本
  lecture?: string;            // 详细讲义（Markdown）
  /** 场景配置 */
  scene: LessonSceneConfig;
  /** 问题（可选） */
  question?: LessonQuestion;
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
  basemap?: 'satellite' | 'terrain' | 'political' | 'osm';
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
