/**
 * Geography Command Bus —— 统一命令总线
 *
 * 老师点击按钮和语音指令必须经过同一个 Command Bus。
 * 不存在两套相互独立的实现。
 * 所有操作都返回统一的成功、失败、加载中和撤销状态。
 */

import * as Cesium from 'cesium';
import { ToolCall, ToolResult, validateToolCall } from './schema';
import { useGeographyStore } from '../state/store';
import { CesiumController } from '../cesium/controller';
import { LessonRuntime } from '../lessons/runtime';

type CommandHandler = (call: ToolCall, ctx: CommandContext) => Promise<ToolResult>;

export interface CommandContext {
  cesium: CesiumController | null;
  lesson: LessonRuntime | null;
}

class CommandBus {
  private handlers = new Map<string, CommandHandler>();
  private ctx: CommandContext = { cesium: null, lesson: null };
  private history: ToolCall[] = [];
  private listeners = new Set<(call: ToolCall, result: ToolResult) => void>();
  private registered = false;

  /** 注册命令上下文（Cesium 控制器、课程运行时） */
  setContext(ctx: Partial<CommandContext>) {
    this.ctx = { ...this.ctx, ...ctx };
  }

  /** 获取当前上下文（供 handler 使用） */
  getContext(): CommandContext {
    return this.ctx;
  }

  /** 是否已注册处理器（防重复） */
  hasRegistered(): boolean {
    return this.registered;
  }

  /** 标记已注册 */
  markRegistered(): void {
    this.registered = true;
  }

  /** 注册命令处理器 */
  register(name: string, handler: CommandHandler) {
    this.handlers.set(name, handler);
  }

  /** 订阅命令执行事件 */
  subscribe(listener: (call: ToolCall, result: ToolResult) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 执行命令（手动按钮和 AI 都调用此方法） */
  async execute(call: ToolCall): Promise<ToolResult> {
    // 1. 参数校验
    const validationError = validateToolCall(call);
    if (validationError) {
      this.notify(call, validationError);
      return validationError;
    }

    // 2. 查找处理器
    const handler = this.handlers.get(call.name);
    if (!handler) {
      const result: ToolResult = {
        ok: false,
        error: `命令 ${call.name} 未注册处理器`,
        code: 'TOOL_NOT_AVAILABLE',
      };
      this.notify(call, result);
      return result;
    }

    // 3. 执行
    try {
      const result = await handler(call, this.ctx);
      if (result.ok) {
        this.history.push(call);
      }
      this.notify(call, result);
      return result;
    } catch (err) {
      const result: ToolResult = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'EXECUTION_FAILED',
      };
      this.notify(call, result);
      return result;
    }
  }

  /** 撤销最后一条命令 */
  async undo(): Promise<ToolResult> {
    const last = this.history.pop();
    if (!last) {
      return { ok: false, error: '没有可撤销的操作', code: 'EXECUTION_FAILED' };
    }
    // 撤销逻辑由具体 handler 实现，这里触发 'undo' 工具
    return this.execute({ name: 'undo', args: { originalCall: last } });
  }

  private notify(call: ToolCall, result: ToolResult) {
    this.listeners.forEach((l) => l(call, result));
  }
}

// 单例
export const commandBus = new CommandBus();

/** 注册所有命令处理器（幂等，多次调用安全） */
export function registerCommandHandlers() {
  const bus = commandBus;
  if (bus.hasRegistered()) return;
  bus.markRegistered();
  const store = useGeographyStore;

  // ============ 镜头控制 ============
  commandBus.register('camera.flyTo', async (call) => {
    const { longitude, latitude, height, duration } = call.args as {
      longitude: number; latitude: number; height?: number; duration?: number;
    };
    store.getState().setCamera({ isFlying: true });
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) {
      await ctrl.flyTo(longitude, latitude, height ?? 5_000_000, duration ?? 2.5);
    }
    store.getState().setCamera({ longitude, latitude, height: height ?? 5_000_000, isFlying: false });
    return { ok: true, message: `已飞至 ${longitude}, ${latitude}` };
  });

  commandBus.register('camera.reset', async () => {
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.resetView();
    store.getState().setCamera({
      longitude: 116.4, latitude: 35.0, height: 15_000_000,
      heading: 0, pitch: -Math.PI / 2, isFlying: false,
    });
    return { ok: true, message: '视角已重置' };
  });

  // ============ 视图模式 ============
  commandBus.register('view.setMode', async (call) => {
    const { mode } = call.args as { mode: '2d' | '3d' | 'columbus' };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.setSceneMode(mode);
    store.getState().setViewMode(mode);
    return { ok: true, message: `视图切换至 ${mode}` };
  });

  commandBus.register('view.setBasemap', async (call) => {
    const { basemap } = call.args as { basemap: 'satellite' | 'terrain' | 'political' | 'osm' };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.setBasemap(basemap);
    store.getState().setBasemap(basemap);
    return { ok: true, message: `底图切换至 ${basemap}` };
  });

  // ============ 太阳系/地球视图切换 ============
  commandBus.register('view.showSolarSystem', async () => {
    store.getState().setSolarSystemActive(true);
    return { ok: true, message: '已切换到太阳系视图' };
  });

  commandBus.register('view.showEarth', async () => {
    store.getState().setSolarSystemActive(false);
    return { ok: true, message: '已切换回地球视图' };
  });

  // ============ 图层控制 ============
  commandBus.register('layer.toggle', async (call) => {
    const { layer, visible } = call.args as { layer: string; visible?: boolean };
    const state = store.getState();

    // 关闭地形分析材质（等高线/高程分层/坡度/坡向互斥清除）
    if (layer === '__clearTerrain__') {
      clearAllTerrainMaterials();
      return { ok: true, message: '地形材质已清除' };
    }

    // 判断属于哪个图层组
    if (layer in state.annotations) {
      state.toggleAnnotation(layer as keyof typeof state.annotations, visible);
    } else if (layer in state.astronomy) {
      state.toggleAstronomy(layer as keyof typeof state.astronomy, visible);
    } else if (layer in state.data) {
      state.toggleData(layer as keyof typeof state.data, visible);
    } else {
      return { ok: false, error: `未知图层: ${layer}`, code: 'INVALID_ARGS' };
    }

    // 同步到 Cesium
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.updateLayer(layer, visible ?? !getStoreLayerValue(layer, state));

    return { ok: true, message: `图层 ${layer} 已${visible ? '显示' : '隐藏'}` };
  });

  // ============ 地形分析（互斥材质） ============

  /** 清除所有地形材质并重置状态 */
  const clearAllTerrainMaterials = () => {
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) ctrl.clearTerrainMaterial();
    store.getState().setTerrain({ contour: false, elevationRamp: false, slope: false, aspect: false });
  };

  commandBus.register('layer.showContour', async (call) => {
    const { spacing } = call.args as { spacing?: number };
    // 互斥：先清除其他材质
    clearAllTerrainMaterials();
    const ctrl = commandBus.getContext().cesium;
    const s = spacing ?? store.getState().terrain.contourSpacing;
    if (ctrl) await ctrl.showContour(s);
    store.getState().setTerrain({ contour: true, contourSpacing: s });
    return { ok: true, message: `等高线已开启，间距 ${s} 米` };
  });

  commandBus.register('layer.showElevationRamp', async () => {
    clearAllTerrainMaterials();
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.showElevationRamp();
    store.getState().setTerrain({ elevationRamp: true });
    return { ok: true, message: '高程分层已开启' };
  });

  commandBus.register('layer.showSlope', async () => {
    clearAllTerrainMaterials();
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.showSlope();
    store.getState().setTerrain({ slope: true });
    return { ok: true, message: '坡度分析已开启' };
  });

  commandBus.register('layer.showAspect', async () => {
    clearAllTerrainMaterials();
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.showAspect();
    store.getState().setTerrain({ aspect: true });
    return { ok: true, message: '坡向分析已开启' };
  });

  commandBus.register('terrain.setExaggeration', async (call) => {
    const { value } = call.args as { value: number };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.setTerrainExaggeration(value);
    store.getState().setTerrain({ exaggeration: value });
    return { ok: true, message: `地形夸张设为 ${value} 倍` };
  });

  // ============ 测量 ============
  commandBus.register('measure.start', async (call) => {
    const { mode } = call.args as { mode: 'distance' | 'area' | 'angle' | 'height' | 'profile' };
    store.getState().setMeasurement({ mode, active: true, result: null });
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.startMeasurement(mode);
    return { ok: true, message: `${mode} 测量已开始` };
  });

  commandBus.register('measure.clear', async () => {
    store.getState().setMeasurement({ mode: 'none', active: false, result: null });
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.clearMeasurement();
    return { ok: true, message: '测量已清除' };
  });

  // ============ 动画 ============
  commandBus.register('animation.play', async () => {
    store.getState().patch({
      time: { ...store.getState().time, isPlaying: true },
      astronomy: { ...store.getState().astronomy, rotation: true },
    });
    return { ok: true, message: '动画已播放' };
  });

  commandBus.register('animation.pause', async () => {
    store.getState().patch({
      time: { ...store.getState().time, isPlaying: false },
      astronomy: { ...store.getState().astronomy, rotation: false },
    });
    return { ok: true, message: '动画已暂停' };
  });

  commandBus.register('animation.setSpeed', async (call) => {
    const { speed } = call.args as { speed: number };
    const s = store.getState();
    s.setRotationSpeed(speed);
    // 自转进行中时同步更新速度
    if (s.astronomy.rotation) {
      const ctrl = commandBus.getContext().cesium;
      if (ctrl) ctrl.setRotation(true, speed);
    }
    return { ok: true, message: `动画速度设为 ${speed}x` };
  });

  // ============ 天文参数 ============
  commandBus.register('astronomy.setAxisTilt', async (call) => {
    const { value } = call.args as { value: number };
    store.getState().setAxisTilt(value);
    // 同步 controller：若地轴图层开启，实时更新地轴线方向
    const ctrl = commandBus.getContext().cesium;
    if (ctrl && store.getState().astronomy.axis) {
      ctrl.updateLayer('axis', true);
    }
    return { ok: true, message: `地轴倾角设为 ${value}°` };
  });

  commandBus.register('astronomy.setSunHeight', async (call) => {
    const { value } = call.args as { value: number };
    store.getState().setSunHeight(value);
    // 同步 controller：更新直射点位置与光照方向
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) ctrl.setSunHeight(value);
    return { ok: true, message: `太阳高度角设为 ${value}°` };
  });

  commandBus.register('astronomy.setRevolutionSpeed', async (call) => {
    const { speed } = call.args as { speed: number };
    store.getState().setRevolutionSpeed(speed);
    return { ok: true, message: `公转速度设为 ${speed}x` };
  });

  // ============ 标注 ============
  commandBus.register('annotate.addPoint', async (call) => {
    const { longitude, latitude, label } = call.args as {
      longitude: number; latitude: number; label?: string;
    };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) {
      ctrl.addMeasureEntity({
        position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
        label: label ? { text: label, font: '14px Noto Sans SC' } : undefined,
        billboard: undefined,
      });
    }
    return { ok: true, message: `已添加标注 ${label ?? ''} @ ${longitude}, ${latitude}` };
  });

  commandBus.register('annotate.clearAll', async () => {
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) await ctrl.clearMeasurement();
    return { ok: true, message: '标注已清除' };
  });

  // ============ 地形剖面 ============
  commandBus.register('terrain.profile', async (call) => {
    const { points } = call.args as { points: Array<{ lon: number; lat: number }> };
    if (!Array.isArray(points) || points.length < 2) {
      return { ok: false, error: '剖面路径至少需要 2 个点', code: 'INVALID_ARGS' };
    }
    const ctrl = commandBus.getContext().cesium;
    const heights: number[] = [];
    if (ctrl) {
      for (const p of points) {
        const h = await ctrl.sampleHeight(p.lon, p.lat);
        heights.push(h ?? 0);
      }
    }
    store.getState().setMeasurement({ mode: 'profile', active: true, result: JSON.stringify(heights) });
    return { ok: true, data: { heights }, message: `已生成 ${points.length} 点剖面` };
  });

  // ============ 问题 ============
  commandBus.register('question.ask', async (call) => {
    const { question } = call.args as { question: string };
    store.getState().setUI({
      showLecturePanel: true,
      lectureContent: `### 问题\n\n${question}`,
    });
    return { ok: true, message: `已提问: ${question}` };
  });

  commandBus.register('question.submitAnswer', async () => {
    return { ok: true, message: '答案已提交' };
  });

  // ============ 镜头环绕 ============
  commandBus.register('camera.orbit', async (call) => {
    const { longitude, latitude, radius } = call.args as {
      longitude: number; latitude: number; radius?: number;
    };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) {
      await ctrl.flyTo(longitude, latitude, radius ?? 500000, 1.5);
    }
    return { ok: true, message: `已环绕 ${longitude}, ${latitude}` };
  });

  // ============ 截图 ============
  commandBus.register('camera.screenshot', async (call) => {
    const { filename } = call.args as { filename?: string };
    const ctrl = commandBus.getContext().cesium;
    if (!ctrl) {
      return { ok: false, error: '地球视图未就绪（太阳系视图不支持截图）', code: 'TOOL_NOT_AVAILABLE' };
    }
    const dataUrl = ctrl.takeScreenshot();
    const name = filename?.trim() || `earth-explorer-${Date.now()}.png`;

    // 浏览器端触发下载
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = name;
    link.click();

    return { ok: true, data: { filename: name }, message: `已保存截图 ${name}` };
  });

  // ============ 课程控制 ============
  commandBus.register('lesson.open', async (call) => {
    const { lessonId } = call.args as { lessonId: string };
    const runtime = commandBus.getContext().lesson;
    if (!runtime) {
      return { ok: false, error: '课程运行时未初始化', code: 'TOOL_NOT_AVAILABLE' };
    }
    await runtime.load(lessonId);
    await runtime.start();
    return { ok: true, message: `课程 ${lessonId} 已开始` };
  });

  commandBus.register('lesson.advance', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    await runtime.advance();
    return { ok: true };
  });

  commandBus.register('lesson.pause', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    runtime.pause();
    return { ok: true, message: '课程已暂停' };
  });

  commandBus.register('lesson.resume', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    runtime.resume();
    return { ok: true, message: '课程已恢复' };
  });

  commandBus.register('lesson.reset', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    await runtime.reset();
    return { ok: true, message: '课程已重置' };
  });

  // ============ 解释 ============
  commandBus.register('explain.current', async () => {
    const selected = store.getState().selected;
    if (!selected) {
      return { ok: false, error: '未选中任何对象', code: 'EXECUTION_FAILED' };
    }
    return {
      ok: true,
      data: { object: selected },
      message: `正在解释: ${selected.name}`,
    };
  });

  commandBus.register('explain.location', async (call) => {
    const { longitude, latitude } = call.args as { longitude?: number; latitude?: number };
    const cam = store.getState().camera;
    const lon = longitude ?? cam.longitude;
    const lat = latitude ?? cam.latitude;
    return {
      ok: true,
      data: { longitude: lon, latitude: lat },
      message: `正在解释位置 ${lon.toFixed(2)}, ${lat.toFixed(2)}`,
    };
  });

  // ============ 撤销 ============
  commandBus.register('undo', async () => {
    return { ok: true, message: '已撤销' };
  });
}

/** 获取 store 中某图层当前值 */
function getStoreLayerValue(layer: string, state: ReturnType<typeof useGeographyStore.getState>): boolean {
  if (layer in state.annotations) return state.annotations[layer as keyof typeof state.annotations];
  if (layer in state.astronomy) return state.astronomy[layer as keyof typeof state.astronomy];
  if (layer in state.data) return state.data[layer as keyof typeof state.data];
  return false;
}
