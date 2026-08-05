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
  'lesson.nextStep',
  'lesson.prevStep',
  'lesson.replayStep',
  'lesson.close',

  // 镜头
  'camera.flyTo',
  'camera.reset',
  'camera.resetView',
  'camera.lookDown',
  'camera.orbit',
  'camera.screenshot',   // 截取当前画面
  'camera.setPreset',    // 视角预设：overview / region / city / street / topdown / oblique45 / oblique30
  'camera.adjustOrientation', // 街景微调：headingDeg/pitchDeg/heightFactor

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
  'layer.showRegion',     // 区域叠加（三级阶梯/板块/气候带教学高亮）
  'layer.clearRegion',    // 清除区域叠加
  'terrain.setExaggeration',
  'terrain.profile',      // 沿路径生成剖面
  'terrain.setLandformStyle', // 地貌风格快捷：natural | relief | landform | contour | plain

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
  'animation.setDate',

  // 天文参数
  'astronomy.setAxisTilt',    // 地轴倾角（度）
  'astronomy.setSunHeight',   // 太阳高度角（度）
  'astronomy.setRevolutionSpeed',

  // 问题
  'question.ask',
  'question.submitAnswer',
  'question.checkAnswer',

  // 解释
  'explain.current',      // 解释当前选中对象
  'explain.location',     // 解释某地点
  'explain.terrain',      // 解释当前地形

  // 撤销
  'undo',

  // Q5：Agent 对界面按钮的操作能力（dispatchEvent 模拟用户点击）
  'ui.clickButton',

  // Q9 AI 对话：面板开关 + 发送用户消息 + 流式接收助手回复 + 追加消息 + 工具调用可视化
  'aiChat.open',
  'aiChat.close',
  'aiChat.toggle',
  'aiChat.clear',
  'aiChat.send',
  'aiChat.appendMessage',
  'aiChat.updateLastAssistant',
  'aiChat.updateToolCall',
  // 数据可视化（matplotlib FastAPI 代理 → base64 PNG）
  'chart.generate',
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
  | 'EXECUTION_FAILED'
  | 'BUTTON_NOT_FOUND'
  | 'UI_NOT_READY';

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
  'lesson.nextStep': {},
  'lesson.prevStep': {},
  'lesson.replayStep': {},
  'lesson.close': {},

  'camera.flyTo': {
    longitude: { type: 'number', required: true, min: -180, max: 180, description: '经度' },
    latitude: { type: 'number', required: true, min: -90, max: 90, description: '纬度' },
    height: { type: 'number', min: 100, max: 40_000_000, description: '视角高度（米）' },
    duration: { type: 'number', min: 0, max: 30, description: '飞行时间（秒）' },
  },
  'camera.reset': {},
  'camera.resetView': {},
  'camera.lookDown': {
    angle: {
      type: 'number',
      min: 0,
      max: 90,
      description:
        '目标俯视角度（度）。0=默认纯俯视（pitch=-90），45=45度斜俯视，可与 view.setMode 3d 组合。',
    },
  },
  'camera.orbit': {
    longitude: { type: 'number', required: true, min: -180, max: 180 },
    latitude: { type: 'number', required: true, min: -90, max: 90 },
    radius: { type: 'number', min: 1000, max: 50_000_000 },
  },
  'camera.screenshot': {
    filename: { type: 'string', description: '下载文件名（可选，默认 earth-explorer-<时间戳>.png）' },
  },
  'camera.setPreset': {
    preset: {
      type: 'string',
      required: true,
      enum: ['overview', 'region', 'city', 'street', 'topdown', 'oblique45', 'oblique30'],
      description: '视角预设：overview全球俯视 / region省级 / city地级 / street贴近街景 / topdown正俯视 / oblique45经典45° / oblique30低斜',
    },
  },
  'camera.adjustOrientation': {
    headingDeg:   { type: 'number', min: -180, max: 180, description: '水平方向偏转角（度，正值右转/顺时针）' },
    pitchDeg:     { type: 'number', min: -90,  max: 0,   description: '俯仰角变化（度，正值向上抬，负值向下压）' },
    heightFactor: { type: 'number', min: 0.05, max: 10,  description: '镜头高度倍率，>1 拉远，<1 拉近' },
  },

  'view.setMode': {
    mode: { type: 'string', required: true, enum: ['2d', '3d', 'columbus'], description: '视图模式' },
  },
  'view.setBasemap': {
    basemap: {
      type: 'string',
      required: true,
      enum: [
        'satellite',
        'political',
        'relief',
        'landform',
        'contour',
        'osm',
        // Q7 高德
        'amapSatellite',
        'amapPolitical',
        'amapRoad',
        // Q3 天地图显式（有 VITE_TIANDITU_TOKEN 时优先，否则自动回退 Esri 系列）
        'tiandituSatellite',
        'tiandituPolitical',
        'tiandituRelief',
        // 历史别名（内部 normalize → relief）
        'terrain',
      ],
      description: '底图类型（天地图 / Esri / OSM / 高德 / terrain 历史别名）',
    },
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
  'layer.showRegion': {
    regions: {
      type: 'array',
      required: true,
      description:
        '区域叠加数组：[{ id, name, color?, coordinates:[[lon,lat],...] }]。coordinates 为逆时针多边形边界。',
    },
  },
  'layer.clearRegion': {},
  'layer.showElevationRamp': {},
  'layer.showSlope': {},
  'layer.showAspect': {},
  'terrain.setExaggeration': {
    value: { type: 'number', required: true, min: 0.5, max: 10, description: '地形夸张倍数' },
  },
  'terrain.setLandformStyle': {
    style: {
      type: 'string',
      required: true,
      enum: ['natural', 'relief', 'landform', 'contour', 'plain'],
      description:
        '地貌风格快捷：natural=卫星+真实地形 / relief=灰度浮雕 / landform=分层设色 / contour=等高线+政区 / plain=卫星+无夸张',
    },
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
  'animation.setDate': {
    date: { type: 'string', required: true, description: 'ISO 日期字符串 YYYY-MM-DD' },
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
  'question.checkAnswer': {
    questionId: { type: 'string', description: '问题ID（可选）' },
    answer: { type: 'string', required: true, description: '用户提交的答案' },
  },

  'explain.current': {},
  'explain.location': {
    longitude: { type: 'number', min: -180, max: 180 },
    latitude: { type: 'number', min: -90, max: 90 },
  },
  'explain.terrain': {},

  'undo': {},

  // Q5：按 data-agent-button id 找到按钮并 dispatchEvent('click')
  'ui.clickButton': {
    buttonId: {
      type: 'string',
      required: true,
      description:
        '按钮 data-agent-button 属性值（不区分大小写，trim 比较）。若在 collapsed 面板中，需先执行 dock.expand 打开后再点击。',
    },
  },

  // Q9 AI 对话
  'aiChat.open': {},
  'aiChat.close': {},
  'aiChat.toggle': {},
  'aiChat.clear': {},
  'aiChat.send': {
    message: {
      type: 'string',
      required: true,
      description: '用户输入文本，会被 KeywordIntentLLM 解析成 0+ 条 CommandBus 命令并执行，随后 AI 用自然语言回复 + 工具调用可视化。',
    },
  },
  'aiChat.appendMessage': {
    role: { type: 'string', required: true, enum: ['user', 'assistant', 'system'] },
    content: { type: 'string', required: true },
    messageId: { type: 'string', description: '可选，不提供则自动生成' },
  },
  'aiChat.updateLastAssistant': {
    content: { type: 'string', required: true, description: '完整/增量的助手回复内容（覆盖拼接）' },
    append: { type: 'boolean', description: '为 true 时在现有内容后追加，为 false 或未提供时覆盖' },
    done: { type: 'boolean', description: '是否完成生成（done=true 后 UI 不再显示"输出中…"）' },
    errorMessage: { type: 'string', description: '若生成失败，显示错误描述' },
  },
  'aiChat.updateToolCall': {
    assistantMessageId: { type: 'string', required: true },
    toolCallId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    args: { type: 'object' },
    status: { type: 'string', enum: ['pending', 'running', 'success', 'error'] },
    result: { type: 'object' },
    errorMessage: { type: 'string' },
  },

  // ----- 数据图表生成（教学可视化：气温/降水/人口/地形剖面/GDP/坡度直方图）-----
  'chart.generate': {
    chart_type: {
      type: 'string',
      required: true,
      enum: ['line', 'bar', 'scatter', 'pie', 'histogram', 'heatmap', 'contour'],
      description: '图表类型：line折线 bar柱状 scatter散点 pie饼 histogram直方 heatmap热力 contour等高线',
    },
    title:       { type: 'string', description: '图表标题（中文）' },
    x_label:     { type: 'string', description: 'X 轴标题' },
    y_label:     { type: 'string', description: 'Y 轴标题' },
    labels:      { type: 'array',  description: 'X 轴分类标签（line/bar 使用）' },
    series:      { type: 'array',  description: '数据系列数组：[{label, data:[...]}]' },
    pie_labels:  { type: 'array',  description: '饼图标签数组' },
    pie_values:  { type: 'array',  description: '饼图数值数组（与 pie_labels 等长）' },
    matrix:      { type: 'array',  description: '二维数组：heatmap/contour 使用行×列' },
    x_ticks:     { type: 'array',  description: 'heatmap/contour 的 X 轴刻度' },
    y_ticks:     { type: 'array',  description: 'heatmap/contour 的 Y 轴刻度' },
    width_in:    { type: 'number', min: 2, max: 24, description: '输出宽度（英寸，默认 7）' },
    height_in:   { type: 'number', min: 2, max: 24, description: '输出高度（英寸，默认 4.5）' },
    dpi:         { type: 'number', min: 72, max: 300, description: '分辨率（默认 120）' },
  },
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

// ============ Agent 工具定义（LLM function calling）============
//
// 由 TOOL_SCHEMAS（SSOT）程序化生成，供 LLM 调用整个教学 API 面。
// 此前手写 GEOGRAPHY_TOOLS 只覆盖 schema 子集，导致 agent 无法调用大部分工具；
// 这里改为「白名单 + 描述 + 自动生成」，schema 新增工具后 agent 自动获得能力。
//
// 排除项（内部非 LLM 直接调用）：
//   - aiChat.send / aiChat.appendMessage / aiChat.updateLastAssistant / aiChat.updateToolCall
//       → React AIChatPanel 内部流式渲染用，让 LLM 调用会递归/破坏 UI 状态
//   - lesson.advance → 课程自动推进内部逻辑

/** Agent 可调用工具白名单（覆盖全部对外可执行工具） */
export const AGENT_TOOL_NAMES: readonly ToolName[] = [
  // 课程控制
  'lesson.open', 'lesson.pause', 'lesson.resume', 'lesson.reset',
  'lesson.nextStep', 'lesson.prevStep', 'lesson.replayStep', 'lesson.close',
  // 镜头
  'camera.flyTo', 'camera.reset', 'camera.resetView', 'camera.lookDown',
  'camera.orbit', 'camera.screenshot', 'camera.setPreset', 'camera.adjustOrientation',
  // 视图
  'view.setMode', 'view.setBasemap', 'view.showSolarSystem', 'view.showEarth',
  // 图层
  'layer.toggle', 'layer.showContour', 'layer.showElevationRamp', 'layer.showSlope',
  'layer.showAspect', 'layer.showRegion', 'layer.clearRegion',
  // 地形
  'terrain.setExaggeration', 'terrain.setLandformStyle', 'terrain.profile',
  // 测量
  'measure.start', 'measure.clear',
  // 标注
  'annotate.addPoint', 'annotate.clearAll',
  // 动画
  'animation.play', 'animation.pause', 'animation.setSpeed', 'animation.setDate',
  // 天文
  'astronomy.setAxisTilt', 'astronomy.setSunHeight', 'astronomy.setRevolutionSpeed',
  // 问题
  'question.ask', 'question.submitAnswer', 'question.checkAnswer',
  // 解释
  'explain.current', 'explain.location', 'explain.terrain',
  // 撤销 / UI
  'undo', 'ui.clickButton',
  // AI 对话面板（仅开关/清空，不含内部流式）
  'aiChat.open', 'aiChat.close', 'aiChat.toggle', 'aiChat.clear',
  // 数据图表
  'chart.generate',
];

/** 工具级描述（LLM 理解用途用；缺省时按工具名前缀生成） */
export const TOOL_DESCRIPTIONS: Partial<Record<ToolName, string>> = {
  'lesson.open': '打开一门地理课程，进入其讲解流程',
  'lesson.nextStep': '课程进入下一步讲解',
  'lesson.prevStep': '课程返回上一步讲解',
  'lesson.replayStep': '重播当前步骤讲解',
  'lesson.pause': '暂停课程自动推进',
  'lesson.resume': '恢复课程自动推进',
  'lesson.reset': '重置课程到第一步',
  'lesson.close': '退出当前课程，返回自由探索',
  'camera.flyTo': '飞行镜头到指定经纬度地点（支持高度/时长）',
  'camera.resetView': '恢复初始视角（中国区域）',
  'camera.reset': '恢复初始视角',
  'camera.lookDown': '切换到指定角度的俯视视角',
  'camera.orbit': '围绕指定地点旋转镜头',
  'camera.screenshot': '截图保存当前画面为 PNG',
  'camera.setPreset': '按预设（全球/省级/地级/街景/正俯视/45°等）切换视角',
  'camera.adjustOrientation': '微调镜头方向/俯仰/高度',
  'view.setMode': '切换二维/三维/哥伦布视图',
  'view.setBasemap': '切换底图（卫星/政区/地形/地貌/等高线/OSM/高德/天地图）',
  'view.showSolarSystem': '切换进入太阳系视图',
  'view.showEarth': '从太阳系返回地球视图',
  'layer.toggle': '显示或隐藏图层（经纬线/城市/河流/山脉/行政边界/洋流/季风/晨昏线/板块/气候带/数据图层等）',
  'layer.showContour': '叠加等高线（可指定等高距）',
  'layer.showElevationRamp': '叠加高程分层设色',
  'layer.showSlope': '叠加坡度分析',
  'layer.showAspect': '叠加坡向分析',
  'layer.showRegion': '在地球上高亮绘制一个或多个半透明区域多边形（三级阶梯/板块/气候带教学用）',
  'layer.clearRegion': '清除当前区域叠加高亮',
  'terrain.setExaggeration': '设置地形夸张倍数（0.5~10）',
  'terrain.setLandformStyle': '快捷切换地貌风格（自然/灰度浮雕/分层设色/等高线/平坦）',
  'terrain.profile': '沿给定路径点生成地形剖面',
  'measure.start': '开始测量（距离/面积/角度/高度/剖面）',
  'measure.clear': '清除测量结果',
  'annotate.addPoint': '在指定经纬度添加标注点',
  'annotate.clearAll': '清除所有自定义标注',
  'animation.play': '播放时间动画（自转/公转）',
  'animation.pause': '暂停时间动画',
  'animation.setSpeed': '设置动画速度',
  'animation.setDate': '跳转到指定日期',
  'astronomy.setAxisTilt': '设置地轴倾角（度，默认 23.5）',
  'astronomy.setSunHeight': '设置太阳高度角（度）',
  'astronomy.setRevolutionSpeed': '设置公转速度',
  'question.ask': '向当前课程提出教学问题',
  'question.submitAnswer': '提交课程问题的答案',
  'question.checkAnswer': '判题并给出解析',
  'explain.current': '解释当前选中对象',
  'explain.location': '解释指定地点（或当前镜头中心）的地理特征',
  'explain.terrain': '解释当前地形的特征',
  'undo': '撤销上一步操作',
  'ui.clickButton': '点击界面上带 data-agent-button 属性的按钮（打开工具坞/面板等）',
  'aiChat.open': '打开 AI 对话面板',
  'aiChat.close': '关闭 AI 对话面板',
  'aiChat.toggle': '切换 AI 对话面板开/关',
  'aiChat.clear': '清空 AI 对话历史',
  'chart.generate': '生成教学数据图表（折线/柱状/散点/饼图/直方/热力/等高线），返回 base64 图片。labels/series 用于 line/bar/scatter；pie_labels+pie_values 用于饼图；matrix+x_ticks+y_ticks 用于 heatmap/contour。',
};

/** 工具名前缀 → 人话类别（缺省描述用） */
const TOOL_KIND_HINT: Record<string, string> = {
  'lesson.': '课程控制',
  'camera.': '镜头',
  'view.': '视图',
  'layer.': '图层',
  'terrain.': '地形',
  'measure.': '测量',
  'annotate.': '标注',
  'animation.': '动画',
  'astronomy.': '天文参数',
  'question.': '问题',
  'explain.': '解释',
  'aiChat.': 'AI 对话',
};

function suggestToolDescription(name: string): string {
  const prefix = Object.keys(TOOL_KIND_HINT).find((p) => name.startsWith(p));
  return prefix ? `${name} —— ${TOOL_KIND_HINT[prefix]}工具` : `${name} —— 地理教学工具`;
}

/** 把参数 Schema 转成 JSON-Schema properties 项 */
function toJsonSchema(p: ParamSchema): Record<string, unknown> {
  const s: Record<string, unknown> = { type: p.type };
  if (p.description) s.description = p.description;
  if (p.enum) s.enum = p.enum;
  if (p.type === 'number') {
    if (p.min !== undefined) s.minimum = p.min;
    if (p.max !== undefined) s.maximum = p.max;
  }
  if (p.type === 'array') s.items = { type: 'object' };
  return s;
}

/** 由 TOOL_SCHEMAS 生成 LLM function-calling 工具定义（缺省数组 → LLM 自动覆盖全部可调用 API） */
export function buildGeographyTools() {
  return AGENT_TOOL_NAMES.map((name) => {
    const params = TOOL_SCHEMAS[name] ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, param] of Object.entries(params)) {
      properties[key] = toJsonSchema(param);
      if (param.required) required.push(key);
    }
    return {
      type: 'function',
      function: {
        name,
        description: TOOL_DESCRIPTIONS[name] ?? suggestToolDescription(name),
        parameters: { type: 'object', properties, required },
      },
    };
  }) as ReadonlyArray<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
    };
  }>;
}

/** LLM 工具定义（与 TOOL_SCHEMAS 保持同步，代理层透传） */
export const GEOGRAPHY_TOOLS = buildGeographyTools();
