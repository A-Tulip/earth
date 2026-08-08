/**
 * Geography Command Bus —— 统一命令总线
 *
 * 老师点击按钮和语音指令必须经过同一个 Command Bus。
 * 不存在两套相互独立的实现。
 * 所有操作都返回统一的成功、失败、加载中和撤销状态。
 */

import * as Cesium from 'cesium';
import { ToolCall, ToolResult, ToolName, validateToolCall } from './schema';
import { useGeographyStore } from '../state/store';
import { CesiumController } from '../cesium/controller';
import { LessonRuntime } from '../lessons/runtime';
import {
  createLLMAdapter,
  KeywordIntentLLM,
  type IntentResult,
  type IntentChatLLM,
} from '../voice/adapters';
import type {
  AIChatMessage,
  AIToolCallVisual,
  AIChatRole,
} from '../state/sceneState';

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

  /**
   * P1-2 统一 Cesium 就绪 guard：
   * - 防止页面刚打开（CesiumCanvas 还没 onReady）时点工具按钮/图层导致 undefined scene 白屏
   * - 返回值使用带 ok 可判别联合：失败时 ok=false + 明确错误消息，成功时 ok=true 且携带 ctrl
   */
  function getCesiumOrError():
    | { ok: true; ctrl: import('../cesium/controller').CesiumController }
    | { ok: false; code: 'EXECUTION_FAILED' | 'UI_NOT_READY'; error: string } {
    const c = commandBus.getContext().cesium;
    if (!c) {
      return {
        ok: false,
        code: 'UI_NOT_READY',
        error: 'Cesium 地球还在初始化中，请 1–2 秒后再试。',
      };
    }
    // 再做一层保护性判空：viewer / scene 被销毁重建期间的窗口
    const v = (c as unknown as { getViewer?: () => unknown }).getViewer?.();
    if (!v) {
      return {
        ok: false,
        code: 'EXECUTION_FAILED',
        error: '地球视图正在切换，请稍后再试。',
      };
    }
    return { ok: true, ctrl: c };
  }

  // ============ 镜头控制 ============
  commandBus.register('camera.flyTo', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { longitude, latitude, height, duration } = call.args as {
      longitude: number; latitude: number; height?: number; duration?: number;
    };
    store.getState().setCamera({ isFlying: true });
    await ctrl.flyTo(longitude, latitude, height ?? 5_000_000, duration ?? 2.5);
    store.getState().setCamera({ longitude, latitude, height: height ?? 5_000_000, isFlying: false });
    return { ok: true, message: `已飞至 ${longitude}, ${latitude}` };
  });

  commandBus.register('camera.reset', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    await ctrl.resetView();
    store.getState().setCamera({
      longitude: 116.4, latitude: 35.0, height: 15_000_000,
      heading: 0, pitch: -Math.PI / 2, isFlying: false,
    });
    return { ok: true, message: '视角已重置' };
  });

  // alias：camera.resetView 同 camera.reset（语音"重置视角"/"回到首页"）
  commandBus.register('camera.resetView', async () =>
    commandBus.execute({ name: 'camera.reset', args: {} })
  );

  // 视角预设：overview / region / city / street / topdown / oblique45 / oblique30
  commandBus.register('camera.setPreset', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const args = call.args as { preset: 'overview' | 'region' | 'city' | 'street' | 'topdown' | 'oblique45' | 'oblique30' };
    store.getState().setCamera({ isFlying: true });
    await ctrl.setViewPreset(args.preset);
    store.getState().setCamera({ isFlying: false });
    return { ok: true, message: `已切换到${args.preset}视角` };
  });

  // 街景视角微调：转头（headingDeg）、俯仰（pitchDeg）、缩放（heightFactor）
  commandBus.register('camera.adjustOrientation', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const args = call.args as { headingDeg?: number; pitchDeg?: number; heightFactor?: number };
    ctrl.adjustOrientation(args);
    const parts: string[] = [];
    if (typeof args.headingDeg === 'number') parts.push(`旋转${args.headingDeg > 0 ? '右' : '左'}${Math.abs(args.headingDeg)}°`);
    if (typeof args.pitchDeg === 'number') parts.push(`俯仰${args.pitchDeg > 0 ? '抬' : '压'}${Math.abs(args.pitchDeg)}°`);
    if (typeof args.heightFactor === 'number') parts.push(args.heightFactor > 1 ? '拉远' : '拉近');
    return { ok: true, message: parts.length ? `视角已${parts.join('，')}` : '视角已微调' };
  });

  // 俯视：相机镜头向下指向当前位置（pitch=-90° 或 angle 指定的角度）
  commandBus.register('camera.lookDown', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const viewer = ctrl.getViewer();
    const cam = viewer.camera;
    const carto = Cesium.Cartographic.fromCartesian(cam.position);
    const height = Math.max(500, carto.height);
    // angle 语义：0 表示纯俯视（pitch = -90°），45 表示 45° 斜俯视（pitch = -45°）
    const rawAngle: unknown = (call.args as any).angle;
    const angle0 = typeof rawAngle === 'number' ? rawAngle : 0;
    const angle = Math.max(0, Math.min(90, isFinite(angle0) ? angle0 : 0));
    const pitch = Cesium.Math.toRadians(angle - 90); // angle=0 → pitch=-90°, angle=45 → pitch=-45°
    // 重新定位：保留 lon/lat/height，仅修正 heading/pitch
    cam.setView({
      destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height),
      orientation: {
        heading: 0,
        pitch,
        roll: 0,
      },
    });
    store.getState().setCamera({
      longitude: Cesium.Math.toDegrees(carto.longitude),
      latitude: Cesium.Math.toDegrees(carto.latitude),
      height,
      heading: 0,
      pitch,
    });
    return { ok: true, message: '已切换到俯视' };
  });

  // ============ 视图模式 ============
  commandBus.register('view.setMode', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { mode } = call.args as { mode: '2d' | '3d' | 'columbus' };
    await ctrl.setSceneMode(mode);
    store.getState().setViewMode(mode);
    return { ok: true, message: `视图切换至 ${mode}` };
  });

  commandBus.register('view.setBasemap', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { basemap } = call.args as { basemap: import('../state/sceneState').BasemapType };
    await ctrl.setBasemap(basemap);
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

    // 同步到 Cesium：即使 Cesium 还没就绪，store 已更新也不报错（等 ready 后 CesiumLayerSync 会根据 store 重绘）
    const ctrlReady = getCesiumOrError();
    if (ctrlReady.ok) {
      await ctrlReady.ctrl.updateLayer(layer, visible ?? !getStoreLayerValue(layer, state));
    }

    return { ok: true, message: `图层 ${layer} 已${visible ? '显示' : '隐藏'}` };
  });

  // ============ 地形分析（互斥材质） ============

  /** 清除所有地形材质并重置状态（即使 Cesium 未就绪，依然先写 store） */
  const clearAllTerrainMaterials = async () => {
    store.getState().setTerrain({ contour: false, elevationRamp: false, slope: false, aspect: false });
    const r = getCesiumOrError();
    if (r.ok) await r.ctrl.clearTerrainMaterial();
  };

  commandBus.register('layer.showContour', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { spacing } = call.args as { spacing?: number };
    // 互斥：先清除其他材质
    await clearAllTerrainMaterials();
    const s = spacing ?? store.getState().terrain.contourSpacing;
    await ctrl.showContour(s);
    store.getState().setTerrain({ contour: true, contourSpacing: s });
    return { ok: true, message: `等高线已开启，间距 ${s} 米` };
  });

  commandBus.register('layer.showElevationRamp', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    await clearAllTerrainMaterials();
    await ctrl.showElevationRamp();
    store.getState().setTerrain({ elevationRamp: true });
    return { ok: true, message: '高程分层已开启' };
  });

  commandBus.register('layer.showSlope', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    await clearAllTerrainMaterials();
    await ctrl.showSlope();
    store.getState().setTerrain({ slope: true });
    return { ok: true, message: '坡度分析已开启' };
  });

  commandBus.register('layer.showAspect', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    await clearAllTerrainMaterials();
    await ctrl.showAspect();
    store.getState().setTerrain({ aspect: true });
    return { ok: true, message: '坡向分析已开启' };
  });

  // ============ Google Earth 真实感 3D Tiles ============
  commandBus.register('layer.toggleGoogleEarth', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;

    // 以 Cesium 场景中的实际状态为准（而非可能滞后的 store 状态）
    const actuallyLoaded = ctrl.isGoogleEarthLoaded();
    if (actuallyLoaded) {
      ctrl.unloadGoogleEarth();
      const stillLoaded = ctrl.isGoogleEarthLoaded();
      if (stillLoaded) {
        return { ok: false, code: 'LOAD_FAILED', error: 'Google Earth 卸载失败，场景中仍有残留 tileset' };
      }
      store.getState().setTerrain({ googleEarth: false });
      return { ok: true, message: 'Google Earth 真实感 3D 已关闭' };
    } else {
      // 先同步 store 状态：避免 UI 显示"开"但实际未加载的错位
      store.getState().setTerrain({ googleEarth: false });
      const success = await ctrl.loadGoogleEarth();
      if (success) {
        store.getState().setTerrain({ googleEarth: true });
        return { ok: true, message: 'Google Earth 真实感 3D 已开启' };
      } else {
        store.getState().setTerrain({ googleEarth: false });
        return { ok: false, code: 'LOAD_FAILED', error: 'Google Earth 加载失败，请检查网络和 Token' };
      }
    }
  });

  // ============ 区域叠加（三级阶梯/板块/气候带教学高亮） ============
  commandBus.register('layer.showRegion', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const regions = (call.args.regions ?? []) as Array<{
      id: string; name: string; color?: string; coordinates: Array<[number, number]>;
    }>;
    if (!Array.isArray(regions) || regions.length === 0) {
      return { ok: false, code: 'INVALID_ARGS', error: 'regions 至少需要一个区域' };
    }
    for (const r of regions) {
      if (!Array.isArray(r.coordinates) || r.coordinates.length < 3) {
        return { ok: false, code: 'INVALID_ARGS', error: `区域 ${r.id ?? r.name} 至少需要 3 个顶点` };
      }
    }
    ready.ctrl.highlightRegions(regions);
    return {
      ok: true,
      message: `已高亮 ${regions.length} 个区域：${regions.map((r) => r.name).join('、')}`,
      data: { count: regions.length, names: regions.map((r) => r.name) },
    };
  });

  commandBus.register('layer.clearRegion', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    ready.ctrl.clearRegions();
    return { ok: true, message: '已清除区域叠加' };
  });

  commandBus.register('terrain.setExaggeration', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { value } = call.args as { value: number };
    await ctrl.setTerrainExaggeration(value);
    store.getState().setTerrain({ exaggeration: value });
    return { ok: true, message: `地形夸张设为 ${value} 倍` };
  });

  commandBus.register('terrain.setContourSpacing', async (call) => {
    const { spacing } = call.args as { spacing: number };
    store.getState().setTerrain({ contourSpacing: spacing });
    // 若等高线已开启，立即用新间距重新渲染
    if (store.getState().terrain.contour) {
      const ready = getCesiumOrError();
      if (ready.ok) {
        await ready.ctrl.showContour(spacing);
      }
    }
    return { ok: true, message: `等高线间距设为 ${spacing} 米` };
  });

  // 地貌风格快捷：natural | relief | landform | contour | plain
  // 对应不同的底图 + 地形夸张组合
  commandBus.register('terrain.setLandformStyle', async (call) => {
    const args = call.args as { style: 'natural' | 'relief' | 'landform' | 'contour' | 'plain' };
    const style = args.style;
    const map = {
      natural:  { basemap: 'satellite', exaggeration: 1.2, name: '真实自然' },
      relief:   { basemap: 'relief',    exaggeration: 2.0, name: '灰度浮雕' },
      landform: { basemap: 'landform',  exaggeration: 2.5, name: '分层设色' },
      contour:  { basemap: 'contour',   exaggeration: 1.5, name: '等高线' },
      plain:    { basemap: 'satellite', exaggeration: 1.0, name: '卫星平铺' },
    } as const;
    const cfg = map[style];
    if (!cfg) return { ok: false, error: `未知地貌风格：${style}`, code: 'INVALID_ARGS' };
    const exaggeration = cfg.exaggeration;
    store.getState().setTerrain({ exaggeration });
    // 同时触发底图切换（basemap 切换会自动应用对应 globe.material + 夸张倍率交叉验证）
    const r1 = await commandBus.execute({ name: 'view.setBasemap', args: { basemap: cfg.basemap } });
    if (!r1.ok) return r1;
    const ready = getCesiumOrError();
    if (ready.ok) {
      await ready.ctrl.setTerrainExaggeration(exaggeration);
    }
    return { ok: true, message: `已切换到${cfg.name}地貌风格（${cfg.basemap}，${cfg.exaggeration}x夸张）` };
  });

  // ============ 测量 ============
  commandBus.register('measure.start', async (call) => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    const { mode } = call.args as { mode: 'distance' | 'area' | 'angle' | 'height' | 'profile' };
    store.getState().setMeasurement({ mode, active: true, result: null });
    await ctrl.startMeasurement(mode);
    return { ok: true, message: `${mode} 测量已开始` };
  });

  commandBus.register('measure.clear', async () => {
    const ready = getCesiumOrError();
    if (!ready.ok) return ready;
    const ctrl = ready.ctrl;
    store.getState().setMeasurement({ mode: 'none', active: false, result: null });
    await ctrl.clearMeasurement();
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

  // 时间跳转（用于公转/节气/季节课程，直接跳到某天）
  commandBus.register('animation.setDate', async (call) => {
    const { date } = call.args as { date: string };
    const ctrl = commandBus.getContext().cesium;
    if (ctrl) {
      const viewer = ctrl.getViewer();
      const julian = Cesium.JulianDate.fromIso8601(date);
      viewer.clock.currentTime = julian;
      // 更新直射点（由 CesiumCanvas 的订阅机制，或手动触发 controller 刷新）
      ctrl.setTimePlaying(viewer.clock.shouldAnimate);
    }
    return { ok: true, message: `已设置日期 ${date}` };
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

  commandBus.register('question.submitAnswer', async (call) => {
    const { answer } = call.args as { answer: string };
    // 答案保存到 store，由 UI 组件通过 question.checkAnswer 判定对错
    store.getState().setUI({ lastUserAnswer: answer });
    return { ok: true, message: '答案已提交' };
  });

  // 判定答案对错（基于当前步骤 step.question 的 answer 或 options）
  commandBus.register('question.checkAnswer', async (call) => {
    const { answer } = call.args as { answer: string; questionId?: string };
    const runtime = commandBus.getContext().lesson;
    const stepQuestion = runtime?.getCurrentQuestion();
    if (!stepQuestion) {
      return { ok: false, error: '当前步骤没有问题', code: 'EXECUTION_FAILED' };
    }
    let correct = false;
    const explanation = stepQuestion.explanation ?? '';
    const correctAnswer = stepQuestion.answer;
    const userAnswer = answer.trim();

    if (Array.isArray(correctAnswer)) {
      // 多选或有多个可接受答案
      correct = correctAnswer.some((a) => a.trim() === userAnswer);
    } else if (typeof correctAnswer === 'string') {
      correct = userAnswer === correctAnswer.trim();
    }

    // 如果是选择题，也接受"选项文本"与"选项索引（A/B/C/D）"匹配
    if (!correct && Array.isArray(stepQuestion.options) && stepQuestion.options.length > 0) {
      const letters = 'ABCDEFGH';
      stepQuestion.options.forEach((optText: string, idx: number) => {
        if (userAnswer === optText.trim()) correct = true;
        const letter = letters[idx] ?? String(idx + 1);
        if (userAnswer === letter || userAnswer === `${letter}.`) correct = true;
      });
    }

    store.getState().setUI({
      lastUserAnswer: answer,
      lastQuestionResult: { correct, explanation },
    });

    // P1-3 课程交互：学生回答正确 → 判题完成 1.5s 后自动进入下一步，课堂流程不中断
    if (correct) {
      try {
        const runtime = commandBus.getContext().lesson;
        const lessonBefore = store.getState().lesson;
        const stepIndexBefore = lessonBefore.currentStep;
        window.setTimeout(() => {
          try {
            const cur = store.getState().lesson;
            // 取消条件：课程已退出 / 用户切到别的步骤 / 已在最后一步
            if (!cur.activeLessonId) return;
            if (cur.currentStep !== stepIndexBefore) return;
            if (cur.finished) return;
            if (!runtime) return;
            void runtime.nextStep().catch(() => null);
          } catch (e) { console.warn('[EmptyCatch] commands/bus.ts:632', (e as any)?.message ?? e); }
        }, 1500);
      } catch (e) { console.warn('[EmptyCatch] commands/bus.ts:634', (e as any)?.message ?? e); }
    }

    return { ok: true, data: { correct, explanation }, message: correct ? '回答正确!' : '回答错误' };
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

  commandBus.register('lesson.nextStep', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    try {
      await runtime.nextStep();
      return { ok: true, message: '已进入下一步' };
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'EXECUTION_FAILED' };
    }
  });

  commandBus.register('lesson.prevStep', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    try {
      await runtime.prevStep();
      return { ok: true, message: '已返回上一步' };
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'EXECUTION_FAILED' };
    }
  });

  commandBus.register('lesson.replayStep', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    try {
      await runtime.replayStep();
      return { ok: true, message: '已重播当前步骤' };
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'EXECUTION_FAILED' };
    }
  });

  commandBus.register('lesson.close', async () => {
    const runtime = commandBus.getContext().lesson;
    if (!runtime) return { ok: false, error: '无活动课程', code: 'EXECUTION_FAILED' };
    try {
      runtime.close();
      return { ok: true, message: '已退出课程' };
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: 'EXECUTION_FAILED' };
    }
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
    // Q4：集成 Nominatim 反向地理编码 + Open-Meteo（按坐标取天气）+ 离线回退
    try {
      const { reverseGeocode, fetchWeatherByCoord } = await import('../data/providers');
      const [geo, weather] = await Promise.all([
        reverseGeocode(lon, lat),
        fetchWeatherByCoord(lon, lat),
      ]);
      const locationBits: string[] = [];
      if (geo.city) locationBits.push(geo.city);
      if (geo.state) locationBits.push(geo.state);
      if (geo.country) locationBits.push(geo.country);
      const locationText = locationBits.length ? locationBits.join('，') : `${lon.toFixed(2)}°E, ${lat.toFixed(2)}°N`;
      const fallbackTag = geo.fallback ? '（离线最近邻）' : '';
      const content =
        `### 位置解释\n\n` +
        `- 坐标：${lon.toFixed(2)}, ${lat.toFixed(2)}\n` +
        `- 地名：${locationText}${fallbackTag}\n` +
        `- 时区：${geo.timezone}\n` +
        `- 天气：${weather.weather} ${weather.temp}℃\n` +
        (geo.postcode ? `- 邮编：${geo.postcode}\n` : '') +
        (geo.suburb ? `- 街区：${geo.suburb}\n` : '') +
        (geo.village ? `- 村镇：${geo.village}\n` : '') +
        (geo.county ? `- 区县：${geo.county}\n` : '') +
        (geo.displayName ? `\n> ${geo.displayName}\n` : '');
      store.getState().setUI({ showLecturePanel: true, lectureContent: content });
      return {
        ok: true,
        data: { longitude: lon, latitude: lat, geo, weather },
        message: `正在解释位置 ${locationText}`,
      };
    } catch (e) {
      return {
        ok: true,
        data: { longitude: lon, latitude: lat },
        message: `正在解释位置 ${lon.toFixed(2)}, ${lat.toFixed(2)}（辅助服务失败，仅返回坐标）`,
      };
    }
  });

  // 解释当前地形状态（夸张倍数 / 等高线间距 / 坡度 / 坡向 / 海拔分层）
  commandBus.register('explain.terrain', async () => {
    const t = store.getState().terrain;
    const active: string[] = [];
    if (t.contour) active.push(`等高线(间距${t.contourSpacing}米)`);
    if (t.elevationRamp) active.push('海拔分层设色');
    if (t.slope) active.push('坡度分析');
    if (t.aspect) active.push('坡向分析');
    const msg = active.length
      ? `地形分析：${active.join('、')}，夸张倍数 ${t.exaggeration}x`
      : `当前无地形分析，地形夸张 ${t.exaggeration}x`;
    store.getState().setUI({ showLecturePanel: true, lectureContent: `### 当前地形\n\n${msg}` });
    return { ok: true, data: { ...t, active }, message: msg };
  });

  // ============ 撤销 ============
  commandBus.register('undo', async () => {
    return { ok: true, message: '已撤销' };
  });

  // ============ Q5：Agent 对界面按钮的操作能力（dispatchEvent 模拟用户点击）============
  commandBus.register('ui.clickButton', async (call) => {
    const buttonId = String(call.args.buttonId).trim();
    if (typeof document === 'undefined') {
      return { ok: false, code: 'UI_NOT_READY', error: 'document 未就绪' };
    }
    // 先精确匹配 data-agent-button 属性（用户写的按钮 id）
    // 用属性选择器 + 直接遍历比较，避免依赖 CSS.escape（部分环境如 jsdom 可能不可用）
    const all = document.querySelectorAll<HTMLElement>('[data-agent-button]');
    let el: HTMLElement | null = null;
    for (const e of Array.from(all)) {
      const attr = (e.getAttribute('data-agent-button') ?? '').trim();
      if (attr === buttonId) { el = e; break; }
    }
    if (!el) {
      // 不区分大小写匹配
      el = Array.from(all).find((e) =>
        (e.getAttribute('data-agent-button') ?? '').trim().toLowerCase() === buttonId.toLowerCase(),
      ) ?? null;
    }
    if (!el) {
      return {
        ok: false,
        code: 'BUTTON_NOT_FOUND',
        error: `未找到按钮 [data-agent-button="${buttonId}"]`,
      };
    }
    // 用 HTMLElement.click() 触发，比手动构造 MouseEvent 更兼容（jsdom/真机均稳定）
    try {
      if (typeof el.click === 'function') {
        el.click();
      } else {
        // 兜底：手动 dispatch click 事件（不带 view，避免部分环境报错）
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    } catch (e) {
      return {
        ok: false,
        code: 'EXECUTION_FAILED',
        error: `点击按钮失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim();
    const short = label.length > 40 ? label.slice(0, 40) + '…' : label;
    return {
      ok: true,
      message: `已点击按钮：${short}`,
      data: { buttonId, label: short },
    };
  });

  // ============ Q9 AI 对话命令 ============
  commandBus.register('aiChat.open', async () => {
    useGeographyStore.getState().setUI({ showAIChat: true });
    return { ok: true, message: '已打开 AI 对话面板' };
  });
  commandBus.register('aiChat.close', async () => {
    useGeographyStore.getState().setUI({ showAIChat: false });
    return { ok: true, message: '已关闭 AI 对话面板' };
  });
  commandBus.register('aiChat.toggle', async () => {
    const s = useGeographyStore.getState();
    const next = !s.ui.showAIChat;
    s.setUI({ showAIChat: next });
    return { ok: true, message: next ? '已打开 AI 对话面板' : '已关闭 AI 对话面板' };
  });
  commandBus.register('aiChat.clear', async () => {
    useGeographyStore.getState().setUI({ aiChatHistory: [], aiChatGenerating: false });
    return { ok: true, message: '已清空对话历史' };
  });

  /** 给 aiChat.send/aiChat.appendMessage 共用：把一条新消息 push 进 history */
  function pushChatMessage(msg: Omit<AIChatMessage, 'id' | 'createdAt'> & { id?: string }) {
    const s = useGeographyStore.getState();
    const history = s.ui.aiChatHistory.slice();
    const full: AIChatMessage = {
      id: msg.id ?? `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...msg,
    };
    history.push(full);
    s.setUI({ aiChatHistory: history });
    return full.id;
  }

  commandBus.register('aiChat.appendMessage', async (call) => {
    const role = String(call.args.role).trim() as AIChatRole;
    const content = String(call.args.content ?? '');
    const messageId = call.args.messageId != null ? String(call.args.messageId) : undefined;
    if (!['user', 'assistant', 'system'].includes(role)) {
      return { ok: false, code: 'INVALID_ARGS', error: `未知 role: ${role}` };
    }
    const id = pushChatMessage({ role, content, id: messageId });
    return { ok: true, message: `已追加消息 ${id}`, data: { messageId: id } };
  });

  commandBus.register('aiChat.updateLastAssistant', async (call) => {
    const content = String(call.args.content ?? '');
    const append = Boolean(call.args.append);
    const done = call.args.done != null ? Boolean(call.args.done) : undefined;
    const errorMessage = call.args.errorMessage != null ? String(call.args.errorMessage) : undefined;
    const s = useGeographyStore.getState();
    const history = s.ui.aiChatHistory.slice();
    let i = history.length - 1;
    while (i >= 0 && history[i].role !== 'assistant') i -= 1;
    if (i < 0) {
      return { ok: false, code: 'NOT_FOUND', error: '未找到最后一条 assistant 消息' };
    }
    const base = history[i];
    const next: AIChatMessage = { ...base };
    next.content = append ? (base.content ?? '') + content : content;
    if (done !== undefined) next.done = done;
    if (errorMessage !== undefined) next.errorMessage = errorMessage;
    history[i] = next;
    const patch: Partial<import('../state/sceneState').TransientUIState> = { aiChatHistory: history };
    if (done === true || errorMessage) patch.aiChatGenerating = false;
    s.setUI(patch);
    return { ok: true, message: '已更新最后一条 assistant 消息' };
  });

  commandBus.register('aiChat.updateToolCall', async (call) => {
    const assistantMessageId = String(call.args.assistantMessageId).trim();
    const toolCallId = String(call.args.toolCallId).trim();
    const name = String(call.args.name).trim();
    const args = (call.args.args ?? {}) as Record<string, unknown>;
    const status = (call.args.status ?? 'running') as AIToolCallVisual['status'];
    const result = call.args.result as Record<string, unknown> | undefined;
    const errorMessage = call.args.errorMessage as string | undefined;
    const s = useGeographyStore.getState();
    const history = s.ui.aiChatHistory.slice();
    const idx = history.findIndex((m) => m.id === assistantMessageId && m.role === 'assistant');
    if (idx < 0) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        error: `未找到 assistant 消息 id=${assistantMessageId}`,
      };
    }
    const msg = { ...history[idx], toolCalls: (history[idx].toolCalls ?? []).slice() };
    const ti = msg.toolCalls.findIndex((tc) => tc.id === toolCallId);
    const now = new Date().toISOString();
    if (ti < 0) {
      const tc: AIToolCallVisual = {
        id: toolCallId,
        name,
        args,
        status,
        result,
        errorMessage,
        startedAt: now,
        finishedAt: status === 'success' || status === 'error' ? now : null,
      };
      msg.toolCalls.push(tc);
    } else {
      const tc = { ...msg.toolCalls[ti] };
      tc.name = name;
      tc.args = args;
      tc.status = status;
      if (result !== undefined) tc.result = result;
      if (errorMessage !== undefined) tc.errorMessage = errorMessage;
      if (status === 'running' && !tc.startedAt) tc.startedAt = now;
      if (status === 'success' || status === 'error') tc.finishedAt = tc.finishedAt ?? now;
      msg.toolCalls[ti] = tc;
    }
    history[idx] = msg;
    s.setUI({ aiChatHistory: history });
    return { ok: true, message: `已更新工具调用 ${toolCallId}`, data: { toolCallId, status } };
  });

  /** Q9 核心：用户在输入框里发送一条消息 → 解析意图 → 调用工具 → 在聊天记录里输出工具调用卡片 + 文字回复 */
  commandBus.register('aiChat.send', async (call) => {
    const textRaw = String(call.args.message ?? '');
    const userMessage = textRaw.trim();
    if (!userMessage) {
      return { ok: false, code: 'INVALID_ARGS', error: '请输入要发送的内容' };
    }
    const s = useGeographyStore.getState();
    if (s.ui.aiChatGenerating) {
      return { ok: false, code: 'EXECUTION_FAILED', error: '上一条消息仍在生成中，请稍后再试' };
    }

    // 1. 追加用户消息；自动拉起面板
    const s0 = useGeographyStore.getState();
    s0.setUI({
      showAIChat: true,
      aiChatGenerating: true,
    });
    pushChatMessage({ role: 'user', content: userMessage });

    // 2. 创建一个 assistant 占位消息（toolCalls 可视化会挂在这里）
    const assistantId = pushChatMessage({
      role: 'assistant',
      content: '',
      done: false,
      toolCalls: [],
    });

    // 3. 调意图解析 + 逐个执行工具调用（每条工具调用都 updateToolCall 让 UI 实时看到 running/success/error）
    try {
      const llm: IntentChatLLM =
        (createLLMAdapter() as unknown as IntentChatLLM) ?? new KeywordIntentLLM();
      const intent: IntentResult =
        typeof (llm as unknown as { runIntent?: unknown }).runIntent === 'function'
          ? await (llm as IntentChatLLM).runIntent(userMessage)
          : await new KeywordIntentLLM().runIntent(userMessage);

      const toolResults: Array<{ name: string; result: ToolResult }> = [];
      for (const tc of intent.toolCalls) {
        const tid = `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        void commandBus.execute?.({
          name: 'aiChat.updateToolCall',
          args: {
            assistantMessageId: assistantId,
            toolCallId: tid,
            name: tc.name,
            args: tc.args,
            status: 'running',
          },
        });
        // 执行用户命令（必须经过 execute 统一进行 Schema 校验 & 错误回退）
        const toolName = tc.name as ToolName;
        const res: ToolResult = commandBus.execute
          ? await commandBus.execute({ name: toolName, args: tc.args })
          : { ok: false, code: 'EXECUTION_FAILED', error: 'commandBus 未就绪' };
        toolResults.push({ name: tc.name, result: res });
        let updateArgs: {
          assistantMessageId: string;
          toolCallId: string;
          name: string;
          args: Record<string, unknown>;
          status: 'success' | 'error';
          result?: Record<string, unknown>;
          errorMessage?: string;
        } = {
          assistantMessageId: assistantId,
          toolCallId: tid,
          name: tc.name,
          args: tc.args,
          status: res.ok ? 'success' : 'error',
        };
        if (res.ok) {
          if (res.data !== undefined) updateArgs.result = res.data as Record<string, unknown>;
        } else {
          updateArgs.errorMessage = res.error;
        }
        void commandBus.execute?.({
          name: 'aiChat.updateToolCall',
          args: updateArgs,
        });
      }

      // 4. 把 AI 自然语言回复写入 assistant.content；顺便把工具执行摘要拼到文字里（方便纯文字用户）
      let reply = intent.replyText || '已完成。';
      type FailedItem = { name: string; result: Extract<ToolResult, { ok: false }> };
      const failures: FailedItem[] = toolResults.filter(
        (t): t is FailedItem => t.result.ok === false,
      );
      if (failures.length > 0) {
        const f = failures
          .slice(0, 3)
          .map((t) => `• ${t.name}：${t.result.error}`)
          .join('\n');
        reply += `\n\n**注意：有 ${failures.length} 条命令执行失败**\n${f}`;
      }
      await commandBus.execute!({
        name: 'aiChat.updateLastAssistant',
        args: {
          content: reply,
          append: false,
          done: true,
        },
      });
      return {
        ok: true,
        message: 'AI 回复已生成',
        data: { assistantMessageId: assistantId, toolResultCount: toolResults.length },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await commandBus.execute!({
        name: 'aiChat.updateLastAssistant',
        args: {
          content: '生成过程中出现异常。',
          append: false,
          done: true,
          errorMessage: msg,
        },
      });
      return { ok: false, code: 'EXECUTION_FAILED', error: msg };
    }
  });

  // ============ 数据图表生成（FastAPI matplotlib 代理 → base64 PNG）============
  commandBus.register('chart.generate', async (call) => {
    const args = call.args as Record<string, unknown>;
    try {
      // 1. 调 FastAPI /api/charts/generate；若 404/网络失败则走前端本地简单渲染兜底
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
      let resp: Response;
      try {
        resp = await fetch('/api/charts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
          signal: controller.signal,
        });
      } catch (e) {
        return {
          ok: false,
          code: 'EXECUTION_FAILED',
          error: '图表服务未启动（FastAPI 未运行？）。请启动：cd api && uvicorn main:app --port 8787，或先使用内置简易图表。',
        };
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        return {
          ok: false,
          code: 'EXECUTION_FAILED',
          error: `图表生成失败（HTTP ${resp.status}）：${txt.slice(0, 200)}`,
        };
      }

      const data = await resp.json().catch(() => ({})) as { ok?: boolean; image?: string; error?: string };
      if (!data.ok || !data.image) {
        return {
          ok: false,
          code: 'EXECUTION_FAILED',
          error: data.error || '图表服务返回格式异常',
        };
      }

      // 2. 把图片展示到 SubtitleLayer：复用 setUI lectureContent 插入 Markdown 图片
      const chartType = String(args.chart_type || 'chart');
      const title = String(args.title || `数据图表（${chartType}）`);
      const markdown =
        `### ${title}\n\n` +
        `<img src="${data.image}" alt="${title}" style="max-width:100%;border:1px solid #e5e5e5;border-radius:8px;" />\n\n` +
        `<div style="color:#6b6b6b;font-size:12px;margin-top:4px;">图表类型：${chartType} · 由 matplotlib 生成</div>`;
      useGeographyStore.getState().setUI({ showLecturePanel: true, lectureContent: markdown });

      return {
        ok: true,
        message: `图表已生成：${title}`,
        data: { image: data.image, chartType, title },
      };
    } catch (err) {
      return {
        ok: false,
        code: 'EXECUTION_FAILED',
        error: `图表生成异常：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}

/** 获取 store 中某图层当前值 */
function getStoreLayerValue(layer: string, state: ReturnType<typeof useGeographyStore.getState>): boolean {
  if (layer in state.annotations) return state.annotations[layer as keyof typeof state.annotations];
  if (layer in state.astronomy) return state.astronomy[layer as keyof typeof state.astronomy];
  if (layer in state.data) return state.data[layer as keyof typeof state.data];
  return false;
}
