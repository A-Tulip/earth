/**
 * 工具协议 Schema —— AI 工具调用的白名单协议
 *
 * AI 不能直接生成和执行任意 Cesium 代码。
 * 所有工具参数通过共享 Schema 校验，设置明确的数值范围、地点标识和权限范围。
 */

/** 工具名称白名单 */
export const TOOL_NAMES = [
  // 课程控制
  'lesson.open',
  'lesson.advance',
  'lesson.pause',
  'lesson.resume',
  'lesson.reset',

  // 镜头
  'camera.flyTo',
  'camera.reset',
  'camera.orbit',
  'camera.screenshot',   // 截取当前画面

  // 视图模式
  'view.setMode',         // 2d | 3d | columbus
  'view.setBasemap',      // satellite | terrain | political | osm
  'view.showSolarSystem', // 切换到太阳系视图（Three.js）
  'view.showEarth',       // 切换回地球视图（CesiumJS）

  // 图层
  'layer.toggle',         // 通用图层开关
  'layer.showContour',
  'layer.showElevationRamp',
  'layer.showSlope',
  'layer.showAspect',
  'terrain.setExaggeration',
  'terrain.profile',      // 沿路径生成剖面

  // 测量
  'measure.start',        // distance | area | angle | height | profile
  'measure.clear',

  // 标注
  'annotate.addPoint',
  'annotate.clearAll',

  // 动画
  'animation.play',
  'animation.pause',
  'animation.setSpeed',

  // 天文参数
  'astronomy.setAxisTilt',    // 地轴倾角（度）
  'astronomy.setSunHeight',   // 太阳高度角（度）
  'astronomy.setRevolutionSpeed',

  // 问题
  'question.ask',
  'question.submitAnswer',

  // 解释
  'explain.current',      // 解释当前选中对象
  'explain.location',     // 解释某地点

  // 撤销
  'undo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** 工具调用请求 */
export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

/** 工具执行结果 */
export type ToolResult =
  | { ok: true; data?: Record<string, unknown>; message?: string }
  | { ok: false; error: string; code: ErrorCode };

export type ErrorCode =
  | 'INVALID_ARGS'
  | 'OUT_OF_RANGE'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'TOOL_NOT_AVAILABLE'
  | 'EXECUTION_FAILED';

/** 参数校验规则 */
export interface ParamSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  enum?: string[];
  description?: string;
}

/** 每个工具的参数 Schema */
export const TOOL_SCHEMAS: Record<ToolName, Record<string, ParamSchema>> = {
  'lesson.open': {
    lessonId: { type: 'string', required: true, description: '课程 ID，如 contour-lines' },
  },
  'lesson.advance': {},
  'lesson.pause': {},
  'lesson.resume': {},
  'lesson.reset': {},

  'camera.flyTo': {
    longitude: { type: 'number', required: true, min: -180, max: 180, description: '经度' },
    latitude: { type: 'number', required: true, min: -90, max: 90, description: '纬度' },
    height: { type: 'number', min: 100, max: 40_000_000, description: '视角高度（米）' },
    duration: { type: 'number', min: 0, max: 30, description: '飞行时间（秒）' },
  },
  'camera.reset': {},
  'camera.orbit': {
    longitude: { type: 'number', required: true, min: -180, max: 180 },
    latitude: { type: 'number', required: true, min: -90, max: 90 },
    radius: { type: 'number', min: 1000, max: 50_000_000 },
  },
  'camera.screenshot': {
    filename: { type: 'string', description: '下载文件名（可选，默认 earth-explorer-<时间戳>.png）' },
  },

  'view.setMode': {
    mode: { type: 'string', required: true, enum: ['2d', '3d', 'columbus'], description: '视图模式' },
  },
  'view.setBasemap': {
    basemap: { type: 'string', required: true, enum: ['satellite', 'terrain', 'political', 'osm'] },
  },
  'view.showSolarSystem': {},
  'view.showEarth': {},

  'layer.toggle': {
    layer: {
      type: 'string',
      required: true,
      enum: [
        'graticule', 'cities', 'labels', 'climateZones', 'plates', 'dateLine',
        'rivers', 'mountains', 'adminBounds', 'oceanCurrents', 'monsoonWinds',
        'axis', 'directPoint', 'twilight', 'dayMode', 'rotation', 'revolution',
        'weather', 'earthquake', 'naturalEvents', 'gdp', 'population', 'temperature', 'precipitation',
        '__clearTerrain__',
      ],
      description: '图层标识',
    },
    visible: { type: 'boolean', description: '是否可见，不传则切换' },
  },
  'layer.showContour': {
    spacing: { type: 'number', min: 10, max: 5000, description: '等高线间距（米）' },
  },
  'layer.showElevationRamp': {},
  'layer.showSlope': {},
  'layer.showAspect': {},
  'terrain.setExaggeration': {
    value: { type: 'number', required: true, min: 0.5, max: 10, description: '地形夸张倍数' },
  },
  'terrain.profile': {
    points: {
      type: 'array',
      required: true,
      description: '剖面路径点 [{lon, lat}, ...]',
    },
  },

  'measure.start': {
    mode: {
      type: 'string',
      required: true,
      enum: ['distance', 'area', 'angle', 'height', 'profile'],
    },
  },
  'measure.clear': {},

  'annotate.addPoint': {
    longitude: { type: 'number', required: true, min: -180, max: 180 },
    latitude: { type: 'number', required: true, min: -90, max: 90 },
    label: { type: 'string' },
  },
  'annotate.clearAll': {},

  'animation.play': {},
  'animation.pause': {},
  'animation.setSpeed': {
    speed: { type: 'number', required: true, min: 0, max: 100, description: '动画速度倍数' },
  },

  'astronomy.setAxisTilt': {
    value: { type: 'number', required: true, min: 0, max: 45, description: '地轴倾角（度，默认 23.5）' },
  },
  'astronomy.setSunHeight': {
    value: { type: 'number', required: true, min: -90, max: 90, description: '太阳高度角（度）' },
  },
  'astronomy.setRevolutionSpeed': {
    speed: { type: 'number', required: true, min: 0, max: 100, description: '公转速度倍数' },
  },

  'question.ask': {
    question: { type: 'string', required: true, description: '问题文本' },
  },
  'question.submitAnswer': {
    answer: { type: 'string', required: true },
  },

  'explain.current': {},
  'explain.location': {
    longitude: { type: 'number', min: -180, max: 180 },
    latitude: { type: 'number', min: -90, max: 90 },
  },

  'undo': {},
};

/** 校验工具调用参数 */
export function validateToolCall(call: ToolCall): ToolResult | null {
  const schema = TOOL_SCHEMAS[call.name];
  if (!schema) {
    return { ok: false, error: `未知工具: ${call.name}`, code: 'TOOL_NOT_AVAILABLE' };
  }

  for (const [paramName, paramSchema] of Object.entries(schema)) {
    const value = call.args[paramName];

    if (paramSchema.required && (value === undefined || value === null)) {
      return {
        ok: false,
        error: `参数 ${paramName} 为必填`,
        code: 'INVALID_ARGS',
      };
    }

    if (value === undefined || value === null) continue;

    if (paramSchema.type === 'number' && typeof value !== 'number') {
      return { ok: false, error: `参数 ${paramName} 必须为数字`, code: 'INVALID_ARGS' };
    }

    if (paramSchema.type === 'string' && typeof value !== 'string') {
      return { ok: false, error: `参数 ${paramName} 必须为字符串`, code: 'INVALID_ARGS' };
    }

    if (paramSchema.type === 'boolean' && typeof value !== 'boolean') {
      return { ok: false, error: `参数 ${paramName} 必须为布尔值`, code: 'INVALID_ARGS' };
    }

    if (paramSchema.type === 'number' && typeof value === 'number') {
      if (paramSchema.min !== undefined && value < paramSchema.min) {
        return { ok: false, error: `参数 ${paramName} 不能小于 ${paramSchema.min}`, code: 'OUT_OF_RANGE' };
      }
      if (paramSchema.max !== undefined && value > paramSchema.max) {
        return { ok: false, error: `参数 ${paramName} 不能大于 ${paramSchema.max}`, code: 'OUT_OF_RANGE' };
      }
    }

    if (paramSchema.enum && !paramSchema.enum.includes(String(value))) {
      return {
        ok: false,
        error: `参数 ${paramName} 必须为 ${paramSchema.enum.join(' | ')} 之一`,
        code: 'INVALID_ARGS',
      };
    }

    if (paramSchema.type === 'array' && !Array.isArray(value)) {
      return { ok: false, error: `参数 ${paramName} 必须为数组`, code: 'INVALID_ARGS' };
    }
  }

  return null; // 校验通过
}
