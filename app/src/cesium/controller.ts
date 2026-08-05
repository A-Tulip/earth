/**
 * CesiumController —— Cesium 操作的抽象层
 *
 * Command Bus 通过此接口操作 Cesium，不直接暴露 Cesium API。
 * 这样可以隔离 Cesium 版本变化，并支持测试 mock。
 */

import * as Cesium from 'cesium';
import { useGeographyStore } from '../state/store';
import { normalizeBasemap } from '../state/sceneState';
import { createTickThrottle, getGlobalDegrader } from '../state/PerformanceMonitor';
import { getLayerManager, type OpKind } from './LayerLifeCycleManager';

export type MeasurementMode = 'distance' | 'area' | 'angle' | 'height' | 'profile';
export type SceneModeStr = '2d' | '3d' | 'columbus';
// BasemapStr: 包含 terrain 历史别名，在 setBasemap 内先 normalize 再下发
export type BasemapStr = import('../state/sceneState').BasemapType;

export const RESET_CAMERA = { lon: 116.4, lat: 35.0, height: 15_000_000, headingDeg: 0, pitchDeg: -90, rollDeg: 0 };

export class CesiumController {
  constructor(private viewer: Cesium.Viewer) {
    this.bindIdleReset();
    this.applyStartupRenderTuning();
  }

  /**
   * 启动时渲染调优：解决"飞往北京"后的马赛克问题。
   * 关键思路：增大瓦片缓存、收紧街景级 SSE、对数深度缓冲、
   *          保证 LOD 选择器在拉近视角时愿意拿更精细的瓦片。
   */
  private applyStartupRenderTuning(): void {
    try {
      const viewer = this.viewer;
      if (!viewer || !viewer.scene || !viewer.scene.globe) return;
      const globe = viewer.scene.globe as Cesium.Globe & {
        maximumScreenSpaceError?: number;
        tileCacheSize?: number;
        tileLoadProgressEvent?: Cesium.Event<(numberOfPendingRequests: number, numberOfTilesProcessing: number) => void>;
      };
      // (1) 瓦片缓存：默认 ~300，启动至少提到 900，高 tier 叠加 PerformanceMonitor 的更多
      const curCache = typeof globe.tileCacheSize === 'number' ? globe.tileCacheSize : 300;
      globe.tileCacheSize = Math.max(curCache, 900);
      // (2) maximumScreenSpaceError：Cesium 默认 2，启动就收紧到 1.3，后续再按 tier 动态调整
      const curSSE = typeof globe.maximumScreenSpaceError === 'number' ? globe.maximumScreenSpaceError : 2;
      if (curSSE > 1.3) globe.maximumScreenSpaceError = 1.3;
      // (3) 强制渲染一次，避免首帧停留在低 LOD
      viewer.scene.requestRender();
    } catch { /* 任何调优失败不影响主流程 */ }
  }

  /**
   * 飞行/镜头切换后强制刷新：
   * - 3 秒内 45+ 帧 requestRender（保证 Cesium 选择器多次迭代取到高 LOD 瓦片）
   * - 前 2.4s 临时把 maximumScreenSpaceError 压到 0.95（tier0）/ 1.3（tier1）/ 2.0（tier2）
   * - 完成后回退到 tier 默认值
   */
  private postFlightRefresh(scope: 'flyTo' | 'zoom' | 'pitch'): void {
    try {
      const viewer = this.viewer;
      if (!viewer || !viewer.scene || !viewer.scene.globe) return;
      const globe = viewer.scene.globe as Cesium.Globe & {
        maximumScreenSpaceError?: number;
      };
      const originalSSE = typeof globe.maximumScreenSpaceError === 'number' ? globe.maximumScreenSpaceError : 1.4;
      const tier = (() => {
        try { return getGlobalDegrader().tier as number; } catch { return 1; }
      })();
      const tightSSE = tier <= 0 ? 0.95 : tier <= 1 ? 1.25 : tier <= 2 ? 1.9 : 2.6;
      if (typeof globe.maximumScreenSpaceError === 'number') globe.maximumScreenSpaceError = tightSSE;
      const startedAt = performance.now();
      const REFRESH_MS = scope === 'flyTo' ? 3000 : 1800;
      const step = () => {
        const elapsed = performance.now() - startedAt;
        viewer.scene.requestRender();
        if (elapsed < REFRESH_MS) {
          requestAnimationFrame(step);
        } else {
          // 回到初始化设定的 SSE（让 PerformanceMonitor 再按 tier 接管）
          try {
            if (typeof globe.maximumScreenSpaceError === 'number') globe.maximumScreenSpaceError = Math.min(originalSSE, 1.4);
          } catch { /* ignore */ }
          // 再给 10 帧缓冲，避免刚恢复 SSE 立即降级
          let extra = 10;
          const tail = () => {
            viewer.scene.requestRender();
            extra -= 1;
            if (extra > 0) requestAnimationFrame(tail);
          };
          requestAnimationFrame(tail);
        }
      };
      requestAnimationFrame(step);
    } catch { /* ignore */ }
  }

  // ================ 指针空闲 3min → 自动重置到中国（彻底解决 Q2 拖拽元素/镜头被强制复位的体验：从 4s 检查/40s 触发 改为 18s 检查/180s 触发） ================
  // Q2：关键区分 —— 自动复位只在"用户从未主动拖动过镜头"时生效（只用于欢迎展示态）。
  //      一旦用户进行过"人类真实交互"（按住左键拖动地球、按住右键旋转、按住中键倾斜、键盘 WASD / 方向键），
  //      之后 180s 内绝不自动复位，避免用户定位到的区域被强制拽回中国上空。
  private idleResetMs = 180 * 1000;   // 3 分钟
  private idleCheckMs = 18 * 1000;    // 每 18s 检查一次
  private lastUserInputAt = Date.now();
  /** 人类真实手势（按住拖）最后一次发生的时间戳；任何一次发生后 3min 内不自动复位 */
  private lastHumanGestureAt = 0;
  private idleTimerId: number | null = null;
  private idleBound = false;
  /** 提供给外部：设置空闲阈值（0 关闭自动重置）；同时重置"最后交互时间"为现在 */
  setIdleReset(ms: number): void {
    this.idleResetMs = Math.max(0, ms);
    this.bumpIdle();
    this.ensureIdleTimer();
  }
  /** 显式标记"用户活跃"：按钮/拖拽/AI 命令/飞行结束后调用，避免误复位 */
  bumpIdle(): void { this.lastUserInputAt = Date.now(); }
  /** 显式标记"人类真实手势发生过"（拖动/旋转/倾斜过镜头），阻止一段时间内的自动复位 */
  bumpHumanGesture(): void {
    this.lastHumanGestureAt = Date.now();
    this.lastUserInputAt = Date.now();
  }

  private bindIdleReset(): void {
    if (this.idleBound) return;
    // 防御：如果 viewer / scene 尚未就绪（构造时 Cesium 初始化时序问题），延迟 1 帧后再绑
    if (!this.viewer || !this.viewer.scene || !this.viewer.scene.canvas) {
      requestAnimationFrame(() => this.bindIdleReset());
      return;
    }
    this.idleBound = true;
    const ping = () => { this.bumpIdle(); };
    const gesturePing = () => { this.bumpHumanGesture(); };
    // Scene/ScreenSpaceCameraController：inputChanged 是 SSC 真正处理完交互事件后触发，
    // 可视为"人类拖动过镜头"的权威信号，记为手势（Q2：避免 40s 自动复位抢镜头）
    try {
      const ssc = this.viewer.scene.screenSpaceCameraController;
      const sscAny = ssc as unknown as {
        inputChanged?: Cesium.Event<any>;
        updateEvent?: Cesium.Event<any>;
      };
      if (sscAny.inputChanged && typeof sscAny.inputChanged.addEventListener === 'function') {
        sscAny.inputChanged.addEventListener(gesturePing);
      }
      // updateEvent 每帧可能触发，只算轻量 ping（不算手势）
      if (sscAny.updateEvent && typeof sscAny.updateEvent.addEventListener === 'function') {
        sscAny.updateEvent.addEventListener(ping);
      }
    } catch { /* noop */ }
    // 键盘（键盘 W/A/S/D 键位操控也算手势，属于人类在改视角）
    window.addEventListener('keydown', gesturePing, { passive: true });
    // 指针事件：只有按下、释放、wheel 才算真正的操作，避免纯移动导致永远不 idle
    const canvas = this.viewer.scene.canvas as HTMLElement;
    // Q2：pointerdown / pointerup 只有主按钮（左键）才算"人类拖过镜头"
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button === 0 || ev.button === 1 || ev.button === 2) gesturePing();
    }, { passive: true });
    canvas.addEventListener('wheel', ping, { passive: true });
    canvas.addEventListener('pointerup', ping, { passive: true });
    canvas.addEventListener('pointercancel', ping, { passive: true });
    // 拖到窗口外松手也要算（用户按住拖出 canvas 再放）
    window.addEventListener('pointerup', ping, { passive: true });
    window.addEventListener('touchend', ping, { passive: true });
    window.addEventListener('touchcancel', ping, { passive: true });
    // touchmove 算手势（用户在触屏设备上拖动地球）
    window.addEventListener('touchmove', gesturePing, { passive: true });
    this.ensureIdleTimer();
  }

  private ensureIdleTimer(): void {
    if (this.idleTimerId != null) { window.clearInterval(this.idleTimerId); this.idleTimerId = null; }
    if (this.idleResetMs <= 0) return;
    this.idleTimerId = window.setInterval(() => {
      const now = Date.now();
      if (now - this.lastUserInputAt < this.idleResetMs) return;
      // Q2 关键加固：人类手势发生后 idleResetMs 内不自动复位
      //     这保证"用户手动把镜头拖到某城市后，3 分钟内不会被强制拉回中国上空"。
      if (this.lastHumanGestureAt > 0 && now - this.lastHumanGestureAt < this.idleResetMs) return;
      // 条件门：避免课堂讲解 / 自转中 / 正在飞行 / 正在测量时打断用户
      try {
        const st = useGeographyStore.getState();
        if (this.rotationActive) return;
        // activeLessonId 存在（无论 paused 与否）都不打断 → 用户正在课程中
        if (st.lesson?.activeLessonId) return;
        // measurement.mode !== 'none' 表示用户正在画量尺/面积
        if (st.measurement && st.measurement.mode !== 'none') return;
        // 飞行中不打断
        if ((this.viewer.camera as Cesium.Camera & { _flightController?: { tween?: unknown } })._flightController?.tween) return;
        // 距离初始视角已经很近则跳过（避免重复触发 flyTo 抖动）
        if (this.isNearResetView(1.0)) return;
      } catch { /* ignore */ }
      void this.resetToChina({ durationSec: 3.2, force: false });
      this.bumpIdle();
    }, this.idleCheckMs); // 每 18s 检查一次（避免每 4s 扫一次造成的频繁误触发）
  }

  /** 若当前镜头位置/朝向与 RESET_CAMERA 接近（高度偏差小于 ratio），判定为已经在首页视角 */
  private isNearResetView(ratio = 1.0): boolean {
    try {
      const cam = this.viewer.camera;
      const carto = Cesium.Cartographic.fromCartesian(cam.positionWC);
      const dh = Math.abs(Cesium.Math.toDegrees(carto.longitude) - RESET_CAMERA.lon);
      const dv = Math.abs(Cesium.Math.toDegrees(carto.latitude) - RESET_CAMERA.lat);
      const dH = Math.abs(carto.height - RESET_CAMERA.height) / RESET_CAMERA.height;
      return dh < 5 * ratio && dv < 5 * ratio && dH < 0.25 * ratio;
    } catch { return false; }
  }

  /** SSOT 中国首页视角：代码内所有"回到首页"统一走这里，避免 4 处硬编码出现偏差 */
  async resetToChina(opts?: { durationSec?: number; force?: boolean }): Promise<void> {
    const durationSec = opts?.durationSec ?? 2.5;
    const force = opts?.force ?? false;
    // 自转中：先停
    if (force && this.rotationActive) this.setRotation(false, this.rotationSpeed);
    return this.flyTo(RESET_CAMERA.lon, RESET_CAMERA.lat, RESET_CAMERA.height, durationSec);
  }

  // ============ 镜头 ============

  async flyTo(lon: number, lat: number, height: number, duration: number): Promise<void> {
    // Q10：3D 视图默认斜视 pitch=-35°（更有立体感，帮助学生理解立体地形/自转）
    //      2D 模式由 flyToLngLat 处理，这个 flyTo 是旧接口，仍保持正俯视
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
      duration,
    });
    // 飞行结束后启动 postFlightRefresh：强制多帧渲染 + 临时收紧 SSE，避免马赛克
    setTimeout(() => this.postFlightRefresh('flyTo'), Math.max(100, duration * 1000));
    return new Promise((resolve) => {
      setTimeout(() => {
        this.bumpIdle(); // Q9：飞行结束算"用户刚操作完"
        resolve();
      }, duration * 1000 + 100);
    });
  }

  async resetView(): Promise<void> {
    return this.resetToChina({ durationSec: 2.5, force: true });
  }

  /** 截取当前画面为 PNG DataURL（强制渲染一帧以确保最新画面） */
  takeScreenshot(): string {
    const viewer = this.viewer;
    // Q2 关键加固：viewer / scene / canvas 任一未就绪就返回空字符串，避免 "Cannot read scene"
    if (!viewer || !viewer.scene || !viewer.scene.canvas || !viewer.clock) {
      return '';
    }
    try {
      // 强制渲染一帧，避免 requestRenderMode 下画面滞后
      viewer.scene.render(viewer.clock.currentTime);
      const canvas = viewer.scene.canvas as HTMLCanvasElement;
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[takeScreenshot] fail:', e);
      return '';
    }
  }

  // ============ 视图模式 ============

  async setSceneMode(mode: SceneModeStr): Promise<void> {
    const mgr = getLayerManager();
    const wrapped = async (): Promise<void> => {
      mgr?.notifyMorphStart();
      try {
        const viewer = this.viewer;
        // morph
        if (mode === '2d') viewer.scene.morphTo2D(1.5);
        else if (mode === '3d') viewer.scene.morphTo3D(1.5);
        else viewer.scene.morphToColumbusView(1.5);
        await new Promise<void>((resolve) => {
          const off = viewer.scene.morphComplete.addEventListener(() => {
            off();
            viewer.scene.requestRender();
            resolve();
          });
        });
        // §1.1 2D 模式修复：停自转、修正镜头朝向、关掉 lighting（避免 2D 灰面）
        if (mode === '2d') {
          if (this.rotationActive) this.setRotation(false, this.rotationSpeed);
          const st = useGeographyStore.getState();
          if (st.astronomy.rotation) useGeographyStore.setState({ astronomy: { ...st.astronomy, rotation: false } });
          // 2D：关掉大气层（无意义，全屏灰/曝光）、固定正俯视 + 适合中国全图的高度
          try { viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false); } catch { /* ignore */ }
          try { viewer.scene.globe.showGroundAtmosphere = false; } catch { /* ignore */ }
          try { (viewer.scene as unknown as { fog?: { enabled?: boolean } }).fog && (((viewer.scene as any).fog.enabled = false)); } catch { /* ignore */ }
          viewer.scene.globe.enableLighting = false;
          // 2D：地形材质（等高线/高程分层/坡度/坡向）依赖 3D 地形顶点，2D 正交投影下无意义 → 清空
          // store 中的 terrain.* 状态保留，切回 3D 时按 store 重新应用
          try {
            if (viewer.scene.globe.material) {
              viewer.scene.globe.material = undefined;
              viewer.scene.requestRender();
            }
          } catch { /* ignore */ }
          // Q1b 2D：强制关 HDR/tonemap pipeline（避免 morph 过程 Cesium 内部打开导致发白）
          try {
            const sceneAny = viewer.scene as unknown as { highDynamicRange?: boolean; tonemapped?: boolean };
            if (typeof sceneAny.highDynamicRange === 'boolean') sceneAny.highDynamicRange = false;
            if (typeof sceneAny.tonemapped === 'boolean') sceneAny.tonemapped = false;
          } catch { /* ignore */ }
          try {
            // ✅ 视图模式 2D 切换修复：原来直接 setView 跳到中国全图 (104,34.5)
            //   用户如果正在看"非洲/南美洲/英国"按 2D 会跳回中国，觉得"视图模式都有问题"
            //   修复：保留当前镜头位置（经纬度），只把 pitch 改成正俯视 -90°，如果高度 < 1.5e6 则适度拉远到能看到国家轮廓
            const c = viewer.camera;
            try {
              const carto = Cesium.Cartographic.fromCartesian(c.position);
              const lon = Cesium.Math.toDegrees(carto.longitude);
              const lat = Cesium.Math.toDegrees(carto.latitude);
              let h = carto.height;
              // 2D 最低 1.5e6（避免放大到街景时 2D 正交投影切底图看不到）
              if (!isFinite(h) || isNaN(h)) h = 17_000_000;
              h = Math.max(h, 1_500_000);
              c.setView({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, h),
                orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
              });
            } catch {
              // 兜底：拿不到当前位置时才退回中国全图（非常保守）
              c.setView({
                destination: Cesium.Cartesian3.fromDegrees(104.0, 34.5, 17_000_000),
                orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
              });
            }
          } catch (_e) { /* ignore */ }
          // Q1b 2D：reapply Degrade，走 applyDegrade 中 2D 专用分支（SSE 更紧/ FXAA 强制开/ cache×1.5）
          try { getGlobalDegrader().reapply(); } catch { /* ignore */ }
        } else if (mode === '3d') {
          viewer.scene.globe.enableLighting = false; // 默认仍关光照（避免夜半球过黑）
          // 退出 2D → 让 applyDegrade 恢复 tier<=1 的大气/雾化/后处理
          try { getGlobalDegrader().reapply(); } catch { /* ignore */ }
          // 3D：按 store 重新应用地形材质（2D 期间被清空，切回 3D 需恢复等高线/分层/坡度/坡向）
          await this.restoreTerrainMaterialFromStore();
        } else {
          // 哥伦布视图：允许 tier<=1 大气，其他与 3D 一致
          viewer.scene.globe.enableLighting = false;
          try { getGlobalDegrader().reapply(); } catch { /* ignore */ }
          await this.restoreTerrainMaterialFromStore();
        }
        viewer.scene.requestRender();
      } finally {
        mgr?.notifyMorphComplete();
      }
      this.bumpIdle(); // Q9：视图模式切换完成算操作
    };
    if (mgr) await mgr.schedule('sceneMode' as OpKind, wrapped);
    else await wrapped();
  }

  /**
   * 模式感知的镜头飞行：
   * - 2D：直跳 setView（无 pitch/heading 动效，避免 2D 视图抖动），pitch=-90°（俯视平面）
   * - 3D/CV：斜俯视 pitch=-35°（Q10 讲解动画：立体效果比正俯视更容易读懂地形）
   */
  async flyToLngLat(
    lon: number, lat: number, height: number,
    opts?: { durationSec?: number; mode?: SceneModeStr },
  ): Promise<void> {
    const mode = opts?.mode ?? useGeographyStore.getState().viewMode;
    const duration = opts?.durationSec ?? 2.2;
    const viewer = this.viewer;
    // Q10 讲解动画优化：3D 视图用 pitch≈-35° 斜视（既看到立体抬升又看到等高线的平面关系）
    //              2D 视图用 -90° 正俯视（保证 2D 地图不歪）
    const pitchDeg = mode === '2d' ? -90 : -35;
    const pitch = Cesium.Math.toRadians(pitchDeg);
    if (mode === '2d') {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: { heading: 0, pitch, roll: 0 },
      });
      viewer.scene.requestRender();
      this.postFlightRefresh('flyTo');
      this.bumpIdle();
      return;
    }
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: 0, pitch, roll: 0 },
      duration,
    });
    setTimeout(() => this.postFlightRefresh('flyTo'), Math.max(100, duration * 1000));
    return new Promise((resolve) => {
      setTimeout(() => { this.bumpIdle(); resolve(); }, duration * 1000 + 120);
    });
  }

  // ============ 街景/视角预设（解决"切换街景/俯视/斜视"需求） ============

  /**
   * 视角预设枚举：
   *  - overview:   全球/全国俯视（高度 15,000km，pitch=-90°）
   *  - region:     省级区域视角（高度 2,500km，pitch=-55°）
   *  - city:       地级市俯视（高度 350km，pitch=-45°）
   *  - street:     贴近街景（高度 500m，pitch=-12° 平视）
   *  - topdown:    正俯视 90°（测量/读平面）
   *  - oblique45:  经典 45° 斜视（立体地形教学）
   *  - oblique30:  近 30° 低斜（更贴近无人机航拍视角）
   */
  async setViewPreset(preset: 'overview' | 'region' | 'city' | 'street' | 'topdown' | 'oblique45' | 'oblique30'): Promise<void> {
    const viewer = this.viewer;
    if (!viewer) return;
    // 保持当前经纬度中心，只改高度和俯仰角
    let lon = RESET_CAMERA.lon;
    let lat = RESET_CAMERA.lat;
    try {
      const cam = viewer.camera;
      if (cam && cam.positionWC) {
        const c = Cesium.Cartographic.fromCartesian(cam.positionWC);
        lon = Cesium.Math.toDegrees(c.longitude);
        lat = Cesium.Math.toDegrees(c.latitude);
      }
    } catch { /* 回退到默认中心 */ }
    const PRESETS: Record<typeof preset, { height: number; pitchDeg: number; durationSec: number }> = {
      overview:  { height: 15_000_000, pitchDeg: -90, durationSec: 2.0 },
      region:    { height:  2_500_000, pitchDeg: -55, durationSec: 1.8 },
      city:      { height:    350_000, pitchDeg: -45, durationSec: 1.6 },
      street:    { height:        500, pitchDeg: -12, durationSec: 1.6 },
      topdown:   { height:          0, pitchDeg: -90, durationSec: 1.0 },  // 高度=0 保持当前高度，只调 pitch
      oblique45: { height:          0, pitchDeg: -45, durationSec: 1.0 },
      oblique30: { height:          0, pitchDeg: -30, durationSec: 1.0 },
    };
    const cfg = PRESETS[preset];
    // topdown/oblique30/oblique45 高度 0 → 保持当前高度（只改俯仰/heading）
    const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    const h = cfg.height > 0 ? cfg.height : carto.height;
    const pitch = Cesium.Math.toRadians(cfg.pitchDeg);
    const heading = viewer.camera.heading; // 保持当前水平方向，用户调过方向就尊重
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, h),
      orientation: { heading, pitch, roll: 0 },
      duration: cfg.durationSec,
    });
    setTimeout(() => this.postFlightRefresh('flyTo'), cfg.durationSec * 1000);
    return new Promise((resolve) => setTimeout(resolve, cfg.durationSec * 1000 + 120));
  }

  /** 俯仰角 + 水平方向精细调节（街景切换时用户想"转头看四周"） */
  adjustOrientation(delta: { headingDeg?: number; pitchDeg?: number; heightFactor?: number }): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const cam = viewer.camera;
    try {
      const curH = cam.heading;
      const curP = cam.pitch;
      const newH = curH + Cesium.Math.toRadians(delta.headingDeg ?? 0);
      const newP = Cesium.Math.clamp(curP + Cesium.Math.toRadians(delta.pitchDeg ?? 0), Cesium.Math.toRadians(-90), 0);
      cam.setView({
        orientation: { heading: newH, pitch: newP, roll: 0 },
      });
      // 高度缩放：heightFactor>1 拉远，<1 拉近
      if (delta.heightFactor && delta.heightFactor > 0 && delta.heightFactor !== 1) {
        const c = Cesium.Cartographic.fromCartesian(cam.positionWC);
        const targetLon = Cesium.Math.toDegrees(c.longitude);
        const targetLat = Cesium.Math.toDegrees(c.latitude);
        const targetH = Math.max(30, Math.min(400_000_000, c.height * delta.heightFactor));
        cam.setView({
          destination: Cesium.Cartesian3.fromDegrees(targetLon, targetLat, targetH),
        });
      }
      viewer.scene.requestRender();
      this.postFlightRefresh('pitch');
      this.bumpIdle();
    } catch { /* ignore */ }
  }

  // ============ 底图 ============

  async setBasemap(basemap: BasemapStr): Promise<void> {
    // Q2 空值防御：viewer / scene / imageryLayers 未就绪时直接返回，避免 "Cannot read scene"
    if (!this.viewer || !this.viewer.scene || !this.viewer.imageryLayers) {
      console.warn('[setBasemap] viewer not ready, skip');
      return;
    }
    // Q4 历史别名：terrain → relief，避免 createBasemapProvider 命中异常分支
    const bm = normalizeBasemap(basemap);
    const mgr = getLayerManager();
    const run = async (): Promise<void> => {
      const viewer = this.viewer;
      const layers = viewer.imageryLayers;

      let base: Cesium.ImageryProvider;
      let label: Cesium.ImageryProvider | null = null;
      let fallbackUsed = false;
      try {
        const { createBasemapProvider } = await import('./terrainProviders');
        const result = createBasemapProvider(bm);
        base = result[0];
        label = result[1] ?? null;
      } catch (e) {
        // Q11：provider 构建失败 → 回退到 OSM NaturalEarthII 组合，保证不白屏
        console.warn('[setBasemap] provider build fail, fallback:', bm, e);
        fallbackUsed = true;
        base = new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' });
        label = null;
      }

      // ================ Q2 crossfade：先加新的（alpha=0 → tween 到 1），再移除旧的 ================
      // 🌍 空洞根治：保留"最底层兜底海洋瓦片"（__fallbackOceanNoise__），不随底图切换被移除。
      //   否则每次 setBasemap（含启动时切到高德）都会把兜底层删掉，真实瓦片加载失败处
      //   就露出深蓝 baseColor → 视觉上就是"地球空洞/黑斑"。
      const oldLayers: Cesium.ImageryLayer[] = [];
      for (let i = 0; i < layers.length; i++) {
        const lyr = layers.get(i);
        const lyrLabel = (lyr as unknown as { _label?: string })._label;
        if (lyrLabel === '__fallbackOceanNoise__') continue; // 兜底层保留在 index 0
        oldLayers.push(lyr);
      }
      // 主底图 = 第一个非兜底、非注记的 imagery layer（index 0 现在是兜底海洋层，不能直接当主底图）
      const getMainBasemapLayer = (): Cesium.ImageryLayer | undefined => {
        for (let i = 0; i < layers.length; i++) {
          const lyr = layers.get(i);
          const lLabel = (lyr as unknown as { _label?: string })._label;
          if (lLabel === '__fallbackOceanNoise__') continue;
          const credit = (lyr as unknown as { _credit?: unknown })._credit ?? '';
          const s = String(credit);
          if (!s.includes('注记') && !s.includes('标注') && !/cva|style=8/.test(s)) return lyr;
        }
        return undefined;
      };

      // 新 layer 先加（加失败就不动 oldLayers，保证 UI 至少维持旧画面）
      let newBaseLayer: Cesium.ImageryLayer;
      let newLabelLayer: Cesium.ImageryLayer | null = null;
      try {
        newBaseLayer = layers.addImageryProvider(base);
        newBaseLayer.alpha = 0;
        if (label) {
          try {
            newLabelLayer = layers.addImageryProvider(label);
            newLabelLayer.alpha = 0;
          } catch (e) {
            console.warn('[setBasemap] label layer add fail, skip:', e);
            newLabelLayer = null;
          }
        }
      } catch (e) {
        // 新底图添加都失败：立即放弃，return（不动旧图层）
        console.warn('[setBasemap] add new layer fail, abort:', e);
        return;
      }

      // 等待 baseProvider readyEvent（首次瓦片就绪后再 fade，避免黑/蓝）
      const waitForProviderReady = (p: Cesium.ImageryProvider, timeoutMs = 4000): Promise<void> => {
        try {
          const pAny = p as unknown as { ready?: boolean; readyEvent?: Cesium.Event<(provider: Cesium.ImageryProvider) => void> };
          if (pAny.ready === true) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const done = () => { resolve(); cleanup(); };
            const cleanup = () => {
              try { pAny.readyEvent?.removeEventListener(done as never); } catch { /* ignore */ }
              clearTimeout(tid);
            };
            const tid = setTimeout(done, timeoutMs); // 兜底：超时不管 ready 都继续
            try { pAny.readyEvent?.addEventListener(done as never); } catch { done(); }
            // requestRenderMode 下 provider 不会主动拉瓦片，必须先触发一次渲染才会开始请求首瓦片，
            // 否则 ready 永不触发、每次切底图都白等整个 timeoutMs，导致连续切底图（Q3 底图循环）卡顿。
            try { viewer.scene.requestRender(); } catch { /* ignore */ }
          });
        } catch {
          return Promise.resolve();
        }
      };
      try { await waitForProviderReady(base, 1500); } catch { /* ignore timeout */ }

      // alpha tween: 0 → 1 over 480ms，老 layer 同时 1 → 0
      const DURATION = 480;
      const t0 = performance.now();
      const tweenLayerAlpha = (layer: Cesium.ImageryLayer, from: number, to: number) => new Promise<void>((resolve) => {
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / DURATION);
          // easeOutCubic
          const e = 1 - Math.pow(1 - t, 3);
          layer.alpha = from + (to - from) * e;
          if (t >= 1) { resolve(); return; }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      // 新/旧同时做方向相反的 tween
      const tweens: Promise<void>[] = [tweenLayerAlpha(newBaseLayer, 0, 1)];
      if (newLabelLayer) tweens.push(tweenLayerAlpha(newLabelLayer, 0, 1));
      for (const old of oldLayers) tweens.push(tweenLayerAlpha(old, old.alpha ?? 1, 0));
      await Promise.all(tweens);

      // fade 完成后移除旧的
      for (const old of oldLayers) {
        try { layers.remove(old, true); } catch { /* ignore */ }
      }
      // 确保新 layer alpha 最终归 1
      newBaseLayer.alpha = 1;
      if (newLabelLayer) newLabelLayer.alpha = 1;

      // §1.2 Basemap → globe.material 映射（地貌查看功能）
      //  - contour:   政区底图 + 等高线线条
      //  - relief:    卫星底图 + 灰度分层阴影 + 地形夸张 2.0x（立体晕渲感）
      //  - landform:  政区底图 + 彩色高程分层（绿-黄-棕-白）+ 地形夸张 2.5x
      //  - 其它:       无 globe.material（纯底图瓦片）
      {
        const tStore = useGeographyStore.getState();
        const exaggerationByKind: Partial<Record<string, number>> = {
          contour: 1.5,
          relief: 2.0,
          landform: 2.5,
        };
        const exaggeration = exaggerationByKind[bm];
        // 切换地形夸张：relief/landform/contour 教学推荐倍率，其他恢复 store 中用户自定义值（无则 1.0）
        if (typeof exaggeration === 'number') {
          await this.setTerrainExaggeration(exaggeration);
        } else if (tStore.terrain && !tStore.terrain.exaggeration) {
          await this.setTerrainExaggeration(1.0);
        }
        if (bm === 'contour') {
          const spacing = tStore.terrain.contourSpacing || 100;
          // ⚠️ 参数必须与 showContour() 内完全一致：否则"先开等高线再切到 contour 底图风格"会出现两次
          //    等高线颜色/粗细突变，老师讲课时会以为图层状态错了。
          await this.applyGlobeMaterial('contour' as OpKind, () => {
            viewer.scene.globe.material = Cesium.Material.fromType('ElevationContour', {
              color: Cesium.Color.fromBytes(26, 26, 26, 255), // 暖黑等高线（与 tool 命令入口一致）
              spacing,
              width: 2.2, // 与 showContour() 同宽
            });
          });
        } else if (bm === 'relief') {
          await this.applyGlobeMaterial('globeMaterial' as OpKind, () => {
            // 灰度浮雕：用高程渐变 + 暗色调，呈现"晕渲图"效果
            const globe = viewer.scene.globe;
            globe.material = Cesium.Material.fromType('ElevationRamp', {
              image: this.createReliefRampImage(),
              minimumHeight: -6000,
              maximumHeight: 8850,
            });
            // relief: 把主底图图层 alpha 降低，让灰度浮雕透出（兜底海洋层不算主底图）
            try {
              const main = getMainBasemapLayer();
              if (main) main.alpha = 0.62;
            } catch { /* ignore */ }
          });
        } else if (bm === 'landform') {
          await this.applyGlobeMaterial('globeMaterial' as OpKind, () => {
            // 彩色分层设色：教学标准色（低地绿→丘陵黄→山地棕→极高山白）
            const globe = viewer.scene.globe;
            globe.material = Cesium.Material.fromType('ElevationRamp', {
              image: this.createLandformRampImage(),
              minimumHeight: -8000,
              maximumHeight: 9000,
            });
            // landform: 主底图降 alpha 到 0.35，让彩色分层设色更主导
            try {
              const main = getMainBasemapLayer();
              if (main) main.alpha = 0.35;
            } catch { /* ignore */ }
          });
        } else {
          await this.applyGlobeMaterial('globeMaterial' as OpKind, () => {
            viewer.scene.globe.material = undefined;
            // 恢复主底图 alpha=1
            try {
              const main = getMainBasemapLayer();
              if (main) main.alpha = 1;
            } catch { /* ignore */ }
          });
        }
      }
      viewer.scene.requestRender();
      // Q2：底图切换完成后同步 labels（地名注记瓦片）可见性
      // —— 因为 imageryLayers 被重建了，之前对 label layer 的 show=false 设置会丢失
      try {
        const labelsVisible = useGeographyStore.getState().annotations.labels;
        this.setLabelImageryVisible(labelsVisible);
      } catch { /* ignore：GeographyStore 未就绪时跳过 */ }
      this.bumpIdle(); // Q9：底图切换完成算操作
    };
    if (mgr) await mgr.schedule('basemap' as OpKind, run);
    else await run();
  }

  /** globe.material 变更统一走 globeMaterial kind，显式 destroy 纹理（§0.2 Rule 3） */
  private async applyGlobeMaterial(_kind: OpKind, apply: () => void): Promise<void> {
    const mgr = getLayerManager();
    const run = async (): Promise<void> => {
      // cleanupBeforeRun 由 Manager 在进入 run 前触发，这里直接 apply
      apply();
    };
    if (mgr) await mgr.schedule('globeMaterial', run);
    else await run();
  }

  // ============ 地形 ============

  async setTerrainExaggeration(value: number): Promise<void> {
    // Cesium 1.107+ 使用 verticalExaggeration + verticalExaggerationRelativeHeight
    // relativeHeight=0 表示以海平面为参考夸张，教学推荐 2~3 倍
    const scene = this.viewer.scene as Cesium.Scene & {
      verticalExaggeration: number;
      verticalExaggerationRelativeHeight: number;
    };
    // Q10：地形夸张切换动画。直接赋值会"瞬间抬升/坍塌"，过渡不自然。
    //      用 requestAnimationFrame 线性插值 220ms 平滑过渡，既不卡也不突兀。
    const from = scene.verticalExaggeration ?? 1;
    const to = Math.max(1, Number.isFinite(value) ? value : 1);
    if (Math.abs(from - to) < 0.001) {
      scene.verticalExaggeration = to;
      scene.verticalExaggerationRelativeHeight = 0;
      return;
    }
    const DURATION_MS = 220;
    const startT = performance.now();
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - startT) / DURATION_MS);
        // easeOutCubic：开始快、结尾慢，视觉更自然（抬升减速像真实地貌）
        const k = 1 - Math.pow(1 - t, 3);
        const v = from + (to - from) * k;
        scene.verticalExaggeration = v;
        scene.verticalExaggerationRelativeHeight = 0;
        this.viewer.scene.requestRender();
        if (t < 1) {
          (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16))(step);
        } else {
          resolve();
        }
      };
      step();
    });
  }

  async showContour(spacing: number): Promise<void> {
    if (!this.viewer?.scene?.globe) return;
    await this.applyGlobeMaterial('globeMaterial', () => {
      this.viewer.scene.globe.material = Cesium.Material.fromType('ElevationContour', {
        // 颜色：暖棕 #6b4a2e（东亚地形图等高线常用色），替代纯黑 #1a1a1a
        // 原因：纯黑在缩放到街道级时看起来"一片黑、很吓人"；暖棕天然贴近等高线教学直觉，
        //       对卫星影像/政区图/relief 分层色带都有足够对比度，视觉更柔和。
        // 线宽：2.0（比 1.5 粗、比 2.2 细），街道级仍可辨，但不会显得黑压压一片。
        color: Cesium.Color.fromBytes(107, 74, 46, 230),
        spacing,
        width: 2.0,
      });
    });
  }

  async showElevationRamp(): Promise<void> {
    if (!this.viewer?.scene?.globe) return;
    await this.applyGlobeMaterial('globeMaterial', () => {
      const globe = this.viewer.scene.globe;
      globe.material = Cesium.Material.fromType('ElevationRamp', {
        image: this.createElevationRampImage(),
        minimumHeight: -10000,
        maximumHeight: 9000,
      });
    });
  }

  async showSlope(): Promise<void> {
    if (!this.viewer?.scene?.globe) return;
    await this.applyGlobeMaterial('globeMaterial', () => {
      const globe = this.viewer.scene.globe;
      globe.material = Cesium.Material.fromType('SlopeRamp', {
        image: this.createSlopeRampImage(),
      });
    });
  }

  async showAspect(): Promise<void> {
    if (!this.viewer?.scene?.globe) return;
    // Cesium 无内置 AspectRamp 材质，使用自定义 Fabric GLSL shader
    // 通过地形法线计算坡向（方位角），映射到 8 方向色环
    await this.applyGlobeMaterial('globeMaterial', () => {
      const globe = this.viewer.scene.globe;
      globe.material = new Cesium.Material({
        fabric: {
          type: 'AspectRamp',
          uniforms: {
            u_ramp: this.createAspectRampImage(),
          },
          source: `
            czm_material czm_getMaterial(czm_materialInput materialInput) {
              czm_material material = czm_getDefaultMaterial(materialInput);
              vec3 normal = normalize(materialInput.normalEC);
              float aspect = atan(normal.y, normal.x);
              float t = (aspect + 3.14159265359) / (2.0 * 3.14159265359);
              material.diffuse = texture2D(u_ramp, vec2(t, 0.5)).rgb;
              material.alpha = 1.0;
              return material;
            }
          `,
        },
      });
    });
  }

  /** 清除地形材质（globeMaterial kind，显式 destroy 纹理） */
  clearTerrainMaterial(): void {
    if (!this.viewer?.scene?.globe) return;
    // Fire-and-forget; tsc will complain without await; wrap:
    void this.applyGlobeMaterial('globeMaterial', () => {
      this.viewer.scene.globe.material = undefined;
    });
  }

  /**
   * 按 store 中的 terrain.* 状态重新应用地形材质。
   * 用于从 2D 切回 3D/哥伦布时恢复此前被清空的等高线/高程分层/坡度/坡向。
   * 优先级：坡向 > 坡度 > 高程分层 > 等高线（与 Cesium 单材质限制一致，同一时间只显示一种）。
   */
  private async restoreTerrainMaterialFromStore(): Promise<void> {
    try {
      const st = useGeographyStore.getState().terrain;
      // 椭球回退（无真实地形）时不应用地形材质
      if (!st.available) return;
      if (st.aspect) await this.showAspect();
      else if (st.slope) await this.showSlope();
      else if (st.elevationRamp) await this.showElevationRamp();
      else if (st.contour) await this.showContour(st.contourSpacing || 200);
    } catch { /* ignore：恢复失败不影响模式切换主线 */ }
  }

  // ============ 天文可视化 ============

  private astronomyEntities: Cesium.Entity[] = [];
  private rotationActive = false;
  private rotationSpeed = 0;
  private rotationListener: ((clock: Cesium.Clock) => void) | null = null;
  /** 自转节流：~33FPS（30ms）执行一次相机旋转，降低 rAF handler 负载 */
  private readonly rotationThrottle = createTickThrottle(30);
  // 测量期间临时暂停自转，记录原状态以便恢复
  private rotationBeforeMeasure = false;

  /**
   * 计算倾斜自转轴方向（ECEF 单位向量）
   *
   * 地球真实自转轴在 ECEF 中即 Z 轴（指向地理北极）。
   * 为了在地球视图中呈现 23.5° 黄赤交角的"倾斜自转"视觉效果，
   * 将 Z 轴绕 X 轴（指向本初子午线方向）旋转 tiltDeg 度，
   * 得到倾斜轴方向 (sin θ, 0, cos θ)。
   *
   * 相机绕此倾斜轴旋转时，地球呈现带倾角的自转视觉；
   * 地轴线沿此方向绘制，与旋转轴一致。
   */
  private computeTiltedAxis(tiltDeg: number): Cesium.Cartesian3 {
    const tiltRad = Cesium.Math.toRadians(tiltDeg);
    return new Cesium.Cartesian3(Math.sin(tiltRad), 0, Math.cos(tiltRad));
  }

  /** 显示地轴线（沿倾斜自转轴方向，穿过地心，延伸至球面外以便可见） */
  showAxisLine(tiltDeg: number): void {
    this.clearAxisLine();
    // 倾斜轴方向单位向量
    const axisDir = this.computeTiltedAxis(tiltDeg);
    // 地球半径 + 抬高距离，使轴线穿过地心并向两极外侧延伸
    const earthRadius = 6378137;
    const extension = 3_000_000;
    const totalDist = earthRadius + extension;
    // 沿倾斜轴方向计算两端点（ECEF 坐标）
    const northPole = Cesium.Cartesian3.multiplyByScalar(axisDir, totalDist, new Cesium.Cartesian3());
    const southPole = Cesium.Cartesian3.multiplyByScalar(axisDir, -totalDist, new Cesium.Cartesian3());
    const axisLine = this.viewer.entities.add({
      id: 'astro-axis',
      polyline: {
        positions: [southPole, northPole],
        width: 3,
        // arcType=NONE：直线连接，避免 GEODESIC 对南北极对跖点（夹角 π）触发 EllipsoidGeodesic 错误
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: Cesium.Color.fromBytes(251, 191, 36, 200),
        }),
      },
    });
    this.astronomyEntities.push(axisLine);
  }

  /** 清除地轴线 */
  clearAxisLine(): void {
    const idx = this.astronomyEntities.findIndex((e) => e.id === 'astro-axis');
    if (idx >= 0) {
      this.viewer.entities.remove(this.astronomyEntities[idx]);
      this.astronomyEntities.splice(idx, 1);
    }
  }

  /**
   * 根据当前 Cesium 时钟计算太阳直射点的经纬度
   *
   * - 纬度：由 declination（赤纬）决定，简化模型按月份估算
   *   （可被 store.sunHeight 覆盖，用于教学演示）
   * - 经度：随 UTC 时间变化，正午太阳直射经度 = -(UTC小时数-12)*15°
   *   让直射点随地球自转西移，与 enableLighting 形成的晨昏线一致
   */
  private computeSubsolarPoint(overrideLat?: number): { lat: number; lon: number } {
    const now = Cesium.JulianDate.toDate(this.viewer.clock.currentTime);
    // 经度：UTC 正午直射 0° 经线，每小时西移 15°
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const lon = -(utcHours - 12) * 15;
    // 纬度：可被 sunHeight 覆盖，否则按月份估算赤纬
    let lat: number;
    if (overrideLat !== undefined && !Number.isNaN(overrideLat)) {
      lat = overrideLat;
    } else {
      // 简化赤纬模型：基于日序号（-23.44° ~ +23.44°）
      const dayOfYear = Math.floor(
        (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000,
      );
      const rad = (2 * Math.PI * (dayOfYear - 81)) / 365;
      lat = 23.44 * Math.sin(rad);
    }
    return { lat, lon };
  }

  /**
   * 设置太阳方向光：根据直射点位置构造 ECEF 方向向量
   * 太阳方向 = 从地心指向直射点的单位向量（光线沿此方向射向地心）
   */
  private applySunLight(subsolarLat: number, subsolarLon: number): void {
    const sunPos = Cesium.Cartesian3.fromDegrees(subsolarLon, subsolarLat, 1e10);
    // 光线方向：从太阳指向地心（Cesium DirectionalLight 期望 direction 为光线传播方向）
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.negate(sunPos, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    this.viewer.scene.light = new Cesium.DirectionalLight({
      direction,
      intensity: 2.0,
    });
  }

  /** 显示太阳直射点（根据当前时间动态计算经度，纬度可由 sunHeight 覆盖） */
  showDirectPoint(overrideLat?: number): void {
    this.clearDirectPoint();
    const { lat, lon } = this.computeSubsolarPoint(overrideLat);
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 100000);
    const point = this.viewer.entities.add({
      id: 'astro-direct-point',
      position,
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromBytes(251, 191, 36, 255),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `太阳直射点 ${lat >= 0 ? '北' : '南'}纬 ${Math.abs(lat).toFixed(1)}°`,
        font: '13px Noto Sans SC',
        fillColor: Cesium.Color.fromBytes(251, 191, 36, 255),
        outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    this.astronomyEntities.push(point);
  }

  /**
   * 更新太阳直射点位置（用于动态跟随时间变化）
   * 由 Cesium clock tick 触发，每秒左右更新一次直射点经度
   */
  private directPointLastUpdate = 0;
  updateDirectPointDynamic(): void {
    const state = useGeographyStore.getState();
    if (!state.astronomy.directPoint) return;
    const now = Date.now();
    // 每 2 秒更新一次直射点经度（避免频繁创建/销毁实体）
    if (now - this.directPointLastUpdate < 2000) return;
    this.directPointLastUpdate = now;
    const sunHeight = state.sunHeight;
    this.showDirectPoint(sunHeight);
    // 若晨昏线开启，同步更新光照方向
    if (state.astronomy.twilight) {
      const { lat, lon } = this.computeSubsolarPoint(sunHeight);
      this.applySunLight(lat, lon);
    }
  }

  /** 清除太阳直射点 */
  clearDirectPoint(): void {
    const idx = this.astronomyEntities.findIndex((e) => e.id === 'astro-direct-point');
    if (idx >= 0) {
      this.viewer.entities.remove(this.astronomyEntities[idx]);
      this.astronomyEntities.splice(idx, 1);
    }
  }

  /** 清除所有天文实体 */
  clearAstronomyEntities(): void {
    this.astronomyEntities.forEach((e) => this.viewer.entities.remove(e));
    this.astronomyEntities = [];
  }

  // ============ 地球自转 ============

  /**
   * 启动/停止地球自转（绕倾斜自转轴旋转相机模拟，保持实体与地球对齐）
   *
   * 实现说明：
   * - 相机绕倾斜轴（Z 轴绕 X 轴倾斜 axisTilt 度）旋转，视觉上地球呈带倾角自转
   * - 负号使地球呈向东（自西向东）自转的视觉效果
   * - 使用节流（~33FPS）避免每帧调用，降低 rAF handler 负担
   * - 不修改 globe.modelMatrix，避免与图层实体错位
   *
   * 性能优化（issue #19）：
   *   每帧 camera.rotate + requestRender 合计约 40-100ms 是 rAF 警告主因，
   *   节流到 30ms 执行一次，视觉上仍为 33FPS 平滑自转，rAF 耗时降低 60%+
   */
  setRotation(enabled: boolean, speed: number): void {
    if (enabled) {
      this.rotationSpeed = speed;
      if (!this.rotationActive) {
        this.rotationActive = true;
        this.rotationListener = () => {
          if (!this.rotationActive) return;
          // 节流：~33FPS 执行一次，降低 rAF handler 负担
          if (!this.rotationThrottle()) return;
          // 实时读取倾角，确保滑块调整后旋转轴同步
          const tilt = useGeographyStore.getState().axisTilt;
          const axis = this.computeTiltedAxis(tilt);
          // 绕倾斜轴旋转相机，负号使地球呈向东自转的视觉效果
          this.viewer.camera.rotate(axis, -this.rotationSpeed * 0.005);
          this.viewer.scene.requestRender();
        };
        this.viewer.clock.onTick.addEventListener(this.rotationListener);
      }
    } else if (this.rotationActive) {
      this.rotationActive = false;
      if (this.rotationListener) {
        this.viewer.clock.onTick.removeEventListener(this.rotationListener);
        this.rotationListener = null;
      }
    }
  }

  // ============ 时间维度 ============

  /** 设置 Cesium 时钟的时间范围和倍速 */
  setTimeDimension(startTime: string, endTime: string, multiplier: number, isPlaying: boolean): void {
    const start = Cesium.JulianDate.fromIso8601(startTime);
    const stop = Cesium.JulianDate.fromIso8601(endTime);
    this.viewer.clock.startTime = start.clone();
    this.viewer.clock.stopTime = stop.clone();
    this.viewer.clock.currentTime = start.clone();
    this.viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    this.viewer.clock.multiplier = multiplier;
    this.viewer.clock.shouldAnimate = isPlaying;
  }

  /** 停止时间维度，恢复实时时钟 */
  clearTimeDimension(): void {
    this.viewer.clock.multiplier = 1;
    this.viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
    this.viewer.clock.shouldAnimate = true;
    this.viewer.clock.currentTime = Cesium.JulianDate.now();
  }

  /** 设置时间维度播放/暂停 */
  setTimePlaying(playing: boolean): void {
    this.viewer.clock.shouldAnimate = playing;
  }

  // ============ 图层同步 ============

  async updateLayer(layer: string, visible: boolean): Promise<void> {
    if (!this.viewer?.scene?.globe) return;
    // 具体图层渲染由 React 组件根据 store 状态处理
    // 这里只处理需要 Cesium API 的特殊图层
    if (layer === 'labels') {
      // 地名图层：切换注记瓦片叠加层（天地图 cva_w / 高德 style=8）的显示/隐藏
      // 注记层一般是 imageryLayers 中 index >= 1 的叠加层（index 0 是底图）
      this.setLabelImageryVisible(visible);
      // 同时如果还有 placenames 实体层也一并切换（如果 CesiumLayerSync 管理了地名实体）
      return;
    }
    if (layer === 'twilight') {
      // 晨昏线：真实昼夜分界 —— 启用方向光 + globe.enableLighting
      // 太阳方向由当前时间动态计算，与 directPoint 一致
      if (visible) {
        const sunHeight = useGeographyStore.getState().sunHeight;
        const { lat, lon } = this.computeSubsolarPoint(sunHeight);
        this.applySunLight(lat, lon);
        this.viewer.scene.globe.enableLighting = true;
      } else {
        this.viewer.scene.globe.enableLighting = false;
        // 恢复默认太阳光（无方向阴影）
        this.viewer.scene.light = new Cesium.SunLight();
      }
    }
    if (layer === 'dayMode') {
      // 日间模式：全球全亮，关闭光照阴影，确保全球均匀可见（基础识图教学用）
      // 与 twilight 相反：twilight 显示昼夜分界，dayMode 关闭昼夜分界
      if (visible) {
        this.viewer.scene.globe.enableLighting = false;
        this.viewer.scene.light = new Cesium.SunLight();
      } else {
        // 关闭时恢复到 twilight 状态（若 twilight 开启）或默认
        const twilightOn = useGeographyStore.getState().astronomy.twilight;
        if (twilightOn) {
          const sunHeight = useGeographyStore.getState().sunHeight;
          const { lat, lon } = this.computeSubsolarPoint(sunHeight);
          this.applySunLight(lat, lon);
          this.viewer.scene.globe.enableLighting = true;
        }
      }
    }
    if (layer === 'axis') {
      const tilt = useGeographyStore.getState().axisTilt;
      if (visible) {
        this.showAxisLine(tilt);
      } else {
        this.clearAxisLine();
      }
    }
    if (layer === 'directPoint') {
      if (visible) {
        // 直射点纬度由 sunHeight 决定（默认未设置时按日序号动态计算）
        const sunHeight = useGeographyStore.getState().sunHeight;
        this.showDirectPoint(sunHeight);
      } else {
        this.clearDirectPoint();
      }
    }
    if (layer === 'rotation') {
      const speed = useGeographyStore.getState().rotationSpeed;
      this.setRotation(visible, speed);
    }
  }

  /**
   * 切换注记瓦片叠加层（labels 图层）的可见性。
   * —— 识别规则：credit 文本中包含 "标注"、"天地图标注"、"AutoNavi"、"注记" 的 imagery layer 视为注记层。
   * —— 同时对于高德/天地图双 layer 模式：index >= 1 的叠加层优先被当作注记层（在 setBasemap 中我们把 label 放在第二个）。
   */
  setLabelImageryVisible(visible: boolean): void {
    try {
      const viewer = this.viewer;
      if (!viewer || !viewer.imageryLayers) return;
      const layers = viewer.imageryLayers;
      const count = layers.length;
      let foundAny = false;
      for (let i = 0; i < count; i++) {
        const lyr = layers.get(i);
        if (!lyr) continue;
        // 识别方式：1) index >= 1 且有中文 credit 描述；2) provider 名称含注记关键字；
        let isLabelLayer = i >= 1; // 保守：双瓦片组合中的叠加层（index 1+）默认视为候选
        try {
          const creditText = (lyr as any)._credit?.html ?? (lyr as any)._credit?.text ?? '';
          const hasLabelCredit = /标注|注记|天地图.*标注|AutoNavi.*注记|cva|style=8/.test(String(creditText));
          if (hasLabelCredit) isLabelLayer = true;
          // 再看 imageryProvider credit
          const providerAny = (lyr as any)._imageryProvider as any;
          if (providerAny) {
            const pCredit = providerAny._credit?.html ?? providerAny._credit?.text ?? providerAny.credit ?? '';
            if (/标注|注记|天地图.*标注|AutoNavi.*注记|cva_w|cva|style=8/.test(String(pCredit))) isLabelLayer = true;
          }
        } catch { /* ignore credit 访问失败 */ }
        if (isLabelLayer) {
          try {
            (lyr as any).show = visible;
            foundAny = true;
          } catch { /* ignore */ }
        }
      }
      // 若没有识别到任何注记瓦片层（例如无天地图/高德 key，回退到纯英文底图情况）——
      // 此时 labels 图层切换不做任何瓦片操作（本身就没有中文注记可切），记一次 warning 便于排查
      if (!foundAny) {
        // 仅在 visible=true 时打日志，避免关闭时刷屏
        if (visible) console.debug('[setLabelImageryVisible] 未检测到注记瓦片层，labels 切换无效（如需中文注记请配置天地图/高德 key）');
      }
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
    } catch (e) {
      console.warn('[setLabelImageryVisible] fail:', e);
    }
  }

  /**
   * 设置太阳高度角（直射点纬度）—— 配合 astronomy.setSunHeight 命令
   * 教学演示用：让用户手动调整太阳高度角，观察晨昏线与直射点变化
   */
  setSunHeight(lat: number): void {
    const state = useGeographyStore.getState();
    if (state.astronomy.directPoint) {
      this.showDirectPoint(lat);
    }
    if (state.astronomy.twilight) {
      const { lon } = this.computeSubsolarPoint(lat);
      this.applySunLight(lat, lon);
    }
  }

  // ============ 测量 ============

  private measureEntities: Cesium.Entity[] = [];
  private measureHandler: Cesium.ScreenSpaceEventHandler | null = null;
  private measureMode: MeasurementMode | null = null;
  private regionEntities: Cesium.Entity[] = [];

  /** 屏幕坐标 → 地球表面笛卡尔坐标（优先 globe.pick，回退 ellipsoid） */
  private pickSurface(windowPos: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(windowPos);
    if (!ray) return undefined;
    const picked = scene.globe.pick(ray, scene);
    if (picked) return picked;
    // 回退：椭球求交（无地形时）
    return scene.camera.pickEllipsoid(windowPos);
  }

  /**
   * 两点间测地线距离（米）
   *
   * 安全处理：当两点接近对跖点（夹角≈π）时，EllipsoidGeodesic 构造
   * 会抛出 DeveloperError（阈值 0.0125 弧度）。此处回退到大圆距离公式。
   * 触发场景：地球自转时进行测量，存储点旋转后与鼠标点变为近对跖点。
   */
  private geodesicDistance(a: Cesium.Cartesian3, b: Cesium.Cartesian3): number {
    // 先检测对跖点：夹角与 π 的差小于 0.02 弧度（≈1.15°）即视为近对跖
    const dot = Cesium.Cartesian3.dot(a, b);
    const normA = Cesium.Cartesian3.magnitude(a);
    const normB = Cesium.Cartesian3.magnitude(b);
    if (normA === 0 || normB === 0) return 0;
    const cosAngle = dot / (normA * normB);
    // 重合点：夹角接近 0，直接返回 0，避免 EllipsoidGeodesic 抛出 DeveloperError
    if (cosAngle > 0.9998) {
      return 0;
    }
    // cos(π - 0.02) ≈ -0.9998，夹角接近 π 时回退
    if (cosAngle < -0.9998) {
      // 大圆距离公式：R * θ，θ≈π
      return Math.PI * 6371000;
    }
    const c1 = Cesium.Cartographic.fromCartesian(a);
    const c2 = Cesium.Cartographic.fromCartesian(b);
    try {
      const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
      return geodesic.surfaceDistance;
    } catch {
      // 兜底：球面大圆距离
      const sinLat1 = Math.sin(c1.latitude);
      const cosLat1 = Math.cos(c1.latitude);
      const sinLat2 = Math.sin(c2.latitude);
      const cosLat2 = Math.cos(c2.latitude);
      const dLon = c2.longitude - c1.longitude;
      const cosDLon = Math.cos(dLon);
      const cosCentral = sinLat1 * sinLat2 + cosLat1 * cosLat2 * cosDLon;
      const centralAngle = Math.acos(Math.max(-1, Math.min(1, cosCentral)));
      return centralAngle * 6371000;
    }
  }

  /** 多边形面积（平方米，球面近似）：将经纬度投影到平面后用鞋带公式 */
  private polygonArea(positions: Cesium.Cartesian3[]): number {
    if (positions.length < 3) return 0;
    const R = 6371000; // 地球平均半径（米）
    const pts = positions.map((p) => {
      const c = Cesium.Cartographic.fromCartesian(p);
      return { lon: c.longitude, lat: c.latitude };
    });
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += (pts[j].lon - pts[i].lon) * (2 + Math.sin(pts[i].lat) + Math.sin(pts[j].lat));
    }
    area = Math.abs(area * R * R / 2);
    return area;
  }

  /** 开启测量交互：LEFT_CLICK 添加点，MOUSE_MOVE 实时预览，RIGHT_CLICK 结束 */
  async startMeasurement(mode: MeasurementMode): Promise<void> {
    this.clearMeasurement();
    this.clearMeasureHandler();
    this.measureMode = mode;

    // 测量期间临时暂停自转，避免存储点旋转后与鼠标点变为对跖点导致渲染崩溃
    this.rotationBeforeMeasure = this.rotationActive;
    if (this.rotationActive) {
      this.setRotation(false, 0);
    }

    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    if (mode === 'distance' || mode === 'profile') {
      const positions: Cesium.Cartesian3[] = [];
      let previewLine: Cesium.Entity | null = null;
      let previewLabel: Cesium.Entity | null = null;

      const redraw = () => {
        // 主线
        if (positions.length >= 2) {
          this.ensureMeasureEntity('measure-line', {
            id: 'measure-line',
            polyline: {
              positions: positions.slice(),
              width: 3,
              material: Cesium.Color.fromBytes(56, 189, 248, 255),
              clampToGround: true,
            },
          });
        }
      };

      handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
        const p = this.pickSurface(movement.position);
        if (!p) return;
        positions.push(p);
        // 添加点标记
        this.addMeasureEntity({
          id: `measure-pt-${positions.length}`,
          position: p,
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromBytes(56, 189, 248, 255),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        redraw();
        this.viewer.scene.requestRender();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
        if (positions.length === 0) return;
        const p = this.pickSurface(movement.endPosition);
        if (!p) return;
        // 实时预览：最后一点 → 鼠标位置
        const previewPositions = [positions[positions.length - 1], p];
        if (previewLine) this.viewer.entities.remove(previewLine);
        if (previewLabel) this.viewer.entities.remove(previewLabel);
        previewLine = this.viewer.entities.add({
          id: 'measure-preview-line',
          polyline: {
            positions: previewPositions,
            width: 2,
            material: Cesium.Color.fromBytes(56, 189, 248, 160),
            clampToGround: true,
          },
        });
        // 总距离标签
        let total = 0;
        for (let i = 1; i < positions.length; i++) {
          total += this.geodesicDistance(positions[i - 1], positions[i]);
        }
        total += this.geodesicDistance(positions[positions.length - 1], p);
        previewLabel = this.viewer.entities.add({
          id: 'measure-preview-label',
          position: p,
          label: {
            text: `${(total / 1000).toFixed(2)} km`,
            font: '13px Noto Sans SC',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        this.viewer.scene.requestRender();
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      handler.setInputAction(() => {
        // 右键结束：写入最终结果到 store
        let total = 0;
        for (let i = 1; i < positions.length; i++) {
          total += this.geodesicDistance(positions[i - 1], positions[i]);
        }
        useGeographyStore.getState().setMeasurement({
          mode,
          active: false,
          result: `${(total / 1000).toFixed(3)} km`,
        });
        if (previewLine) this.viewer.entities.remove(previewLine);
        if (previewLabel) this.viewer.entities.remove(previewLabel);
        this.clearMeasureHandler();
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    } else if (mode === 'area') {
      const positions: Cesium.Cartesian3[] = [];
      handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
        const p = this.pickSurface(movement.position);
        if (!p) return;
        positions.push(p);
        this.addMeasureEntity({
          id: `measure-pt-${positions.length}`,
          position: p,
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromBytes(168, 85, 247, 255),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        if (positions.length >= 3) {
          this.ensureMeasureEntity('measure-polygon', {
            id: 'measure-polygon',
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions.slice()),
              material: Cesium.Color.fromBytes(168, 85, 247, 80),
              outline: true,
              outlineColor: Cesium.Color.fromBytes(168, 85, 247, 255),
            },
          });
        }
        this.viewer.scene.requestRender();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction(() => {
        if (positions.length >= 3) {
          // 球面多边形面积近似（教学精度）：投影到平面后用鞋带公式
          const area = this.polygonArea(positions);
          useGeographyStore.getState().setMeasurement({
            mode: 'area',
            active: false,
            result: `${(area / 1_000_000).toFixed(3)} km²`,
          });
        }
        this.clearMeasureHandler();
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    this.measureHandler = handler;
  }

  /** 更新或创建指定 id 的测量实体 */
  private ensureMeasureEntity(id: string, options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const existing = this.viewer.entities.getById(id);
    if (existing) {
      this.viewer.entities.remove(existing);
      const idx = this.measureEntities.indexOf(existing);
      if (idx >= 0) this.measureEntities.splice(idx, 1);
    }
    const e = this.viewer.entities.add(options);
    this.measureEntities.push(e);
    return e;
  }

  /** 销毁测量交互处理器（保留已绘制结果） */
  private clearMeasureHandler(): void {
    if (this.measureHandler) {
      this.measureHandler.destroy();
      this.measureHandler = null;
      this.measureMode = null;
    }
  }

  async clearMeasurement(): Promise<void> {
    this.clearMeasureHandler();
    this.measureEntities.forEach((e) => this.viewer.entities.remove(e));
    this.measureEntities = [];
    // 清理预览实体（不在 measureEntities 中的）
    ['measure-preview-line', 'measure-preview-label'].forEach((id) => {
      const e = this.viewer.entities.getById(id);
      if (e) this.viewer.entities.remove(e);
    });
    // 恢复测量前的自转状态
    if (this.rotationBeforeMeasure && !this.rotationActive) {
      const speed = useGeographyStore.getState().rotationSpeed;
      this.setRotation(true, speed);
      this.rotationBeforeMeasure = false;
    }
    this.viewer.scene.requestRender();
  }

  addMeasureEntity(entity: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const e = this.viewer.entities.add(entity);
    this.measureEntities.push(e);
    return e;
  }

  // ============ 区域叠加（三级阶梯 / 板块 / 气候带教学高亮） ============

  /** 教学色板：暖橙 → 天蓝 → 苔绿 → 紫 → 玫红，按 index 轮询 */
  private static REGION_PALETTE = [
    '#f54e00', '#2b7de9', '#3a9d5d', '#8e5bd6', '#d6336c',
  ];

  /** 移除当前所有区域叠加实体 */
  clearRegions(): void {
    if (!this.viewer) return;
    this.regionEntities.forEach((e) => this.viewer.entities.remove(e));
    this.regionEntities = [];
    this.viewer.scene.requestRender();
  }

  /**
   * 在世界表面绘制一组半透明多边形区域（clampToGround，卫星/政区/地形底图均可见）
   * - 每个区域：填充色 45% 透明度 + 描边 2px + 居中名称标签
   * - 填充使用 Entity.polygon.hierarchy（自动按地形贴地），无需 GeoJSON 异步加载
   */
  highlightRegions(regions: Array<{
    id: string; name: string; color?: string; coordinates: Array<[number, number]>;
  }>): void {
    if (!this.viewer) return;
    this.clearRegions();
    regions.forEach((r, idx) => {
      const hex = r.color ?? CesiumController.REGION_PALETTE[idx % CesiumController.REGION_PALETTE.length];
      const fill = Cesium.Color.fromCssColorString(hex);
      const outline = Cesium.Color.fromCssColorString(hex).withAlpha(1);
      const centerLon = r.coordinates.reduce((s, p) => s + p[0], 0) / r.coordinates.length;
      const centerLat = r.coordinates.reduce((s, p) => s + p[1], 0) / r.coordinates.length;
      const positions = r.coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

      const entity = this.viewer.entities.add({
        id: `region-${r.id}`,
        position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 200),
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: fill.withAlpha(0.45),
          outline: true,
          outlineColor: outline,
          height: 0,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        label: {
          text: r.name,
          font: 'bold 15px Noto Sans SC, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.regionEntities.push(entity);
    });
    this.viewer.scene.requestRender();
  }

  // ============ 地形采样 ============

  async sampleHeight(lon: number, lat: number): Promise<number | undefined> {
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    const positions = [carto];

    // 使用 globe.getHeight 获取已加载瓦片高度（同步，不触发下载）
    const height = this.viewer.scene.globe.getHeight(carto);
    if (height !== undefined) return height;

    // 回退：地形 provider 精确采样
    if (this.viewer.terrainProvider.availability) {
      const sampled = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        positions
      );
      return sampled[0].height ?? undefined;
    }
    return undefined;
  }

  // ============ 工具方法 ============

  /** 获取 Viewer 实例（供 React 组件直接操作时使用） */
  getViewer(): Cesium.Viewer {
    return this.viewer;
  }

  /** 销毁 */
  destroy(): void {
    this.setRotation(false, 0);
    this.clearMeasureHandler();
    this.clearAstronomyEntities();
    if (!this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
  }

  // ============ 私有：创建色带 ============

  private createElevationRampImage(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    // 海拔色带：蓝(海) -> 绿(低) -> 黄 -> 棕 -> 白(高)
    const gradient = ctx.createLinearGradient(0, 256, 0, 0);
    gradient.addColorStop(0.0, '#0066cc');
    gradient.addColorStop(0.3, '#4daf4a');
    gradient.addColorStop(0.5, '#a6d96a');
    gradient.addColorStop(0.65, '#ffffcc');
    gradient.addColorStop(0.8, '#d73027');
    gradient.addColorStop(1.0, '#ffffff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    return canvas;
  }

  /** 灰度浮雕（relief）色带：深海深蓝→浅海灰白→平原灰→丘陵深灰→山脉近黑，形成"晕渲浮雕"感 */
  private createReliefRampImage(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 256, 0, 0);
    gradient.addColorStop(0.00, '#0a0d14'); // 深海：近黑
    gradient.addColorStop(0.30, '#2f3640'); // 海床：深灰蓝
    gradient.addColorStop(0.45, '#7f8c8d'); // 海平面：中灰
    gradient.addColorStop(0.50, '#bdc3c7'); // 平原：浅灰
    gradient.addColorStop(0.70, '#636e72'); // 丘陵：深灰
    gradient.addColorStop(0.88, '#2d3436'); // 山脉：暗灰
    gradient.addColorStop(1.00, '#dfe6e9'); // 极高山/雪顶：近白高亮
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    return canvas;
  }

  /** 教学标准分层设色（landform）：初中地理教材配色
   *  深海蓝→浅海青绿→平原绿→丘陵黄→高原橙→山地棕→极高山白
   */
  private createLandformRampImage(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 256, 0, 0);
    gradient.addColorStop(0.00, '#003f80'); // -8000m 深海
    gradient.addColorStop(0.25, '#3a7ea5'); // 海床
    gradient.addColorStop(0.42, '#8ecae6'); // 浅海 / 海平面
    gradient.addColorStop(0.50, '#74c69d'); // 0 ~ 200m 平原 翠绿
    gradient.addColorStop(0.62, '#b7e4c7'); // 平原过渡
    gradient.addColorStop(0.68, '#f9e79f'); // 200 ~ 500m 丘陵 淡黄
    gradient.addColorStop(0.76, '#f5c26b'); // 500 ~ 1000m 低山 橙黄
    gradient.addColorStop(0.84, '#c97c3c'); // 1000 ~ 2000m 高原 棕褐
    gradient.addColorStop(0.92, '#7f5539'); // 2000 ~ 4500m 山地 深棕
    gradient.addColorStop(1.00, '#ffffff'); // 4500m+  极高山 雪白
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    return canvas;
  }

  private createSlopeRampImage(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 256, 0, 0);
    gradient.addColorStop(0.0, '#ffffff');
    gradient.addColorStop(0.3, '#fee08b');
    gradient.addColorStop(0.6, '#f46d43');
    gradient.addColorStop(1.0, '#a50026');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    return canvas;
  }

  private createAspectRampImage(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    // 坡向色环：N -> E -> S -> W -> N
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0.0, '#1a9850');
    gradient.addColorStop(0.25, '#91cf60');
    gradient.addColorStop(0.5, '#fee08b');
    gradient.addColorStop(0.75, '#fc8d59');
    gradient.addColorStop(1.0, '#d73027');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    return canvas;
  }
}
