/**
 * CesiumController —— Cesium 操作的抽象层
 *
 * Command Bus 通过此接口操作 Cesium，不直接暴露 Cesium API。
 * 这样可以隔离 Cesium 版本变化，并支持测试 mock。
 */

import * as Cesium from 'cesium';
import { useGeographyStore } from '../state/store';

export type MeasurementMode = 'distance' | 'area' | 'angle' | 'height' | 'profile';
export type SceneModeStr = '2d' | '3d' | 'columbus';
export type BasemapStr = 'satellite' | 'terrain' | 'political' | 'osm';

export class CesiumController {
  constructor(private viewer: Cesium.Viewer) {}

  // ============ 镜头 ============

  async flyTo(lon: number, lat: number, height: number, duration: number): Promise<void> {
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration,
    });
    return new Promise((resolve) => {
      setTimeout(resolve, duration * 1000 + 100);
    });
  }

  async resetView(): Promise<void> {
    await this.flyTo(116.4, 35.0, 15_000_000, 2.5);
  }

  /** 截取当前画面为 PNG DataURL（强制渲染一帧以确保最新画面） */
  takeScreenshot(): string {
    const viewer = this.viewer;
    // 强制渲染一帧，避免 requestRenderMode 下画面滞后
    viewer.scene.render(viewer.clock.currentTime);
    const canvas = viewer.scene.canvas as HTMLCanvasElement;
    return canvas.toDataURL('image/png');
  }

  // ============ 视图模式 ============

  async setSceneMode(mode: SceneModeStr): Promise<void> {
    if (mode === '2d') {
      this.viewer.scene.morphTo2D(1.5);
    } else if (mode === '3d') {
      this.viewer.scene.morphTo3D(1.5);
    } else {
      this.viewer.scene.morphToColumbusView(1.5);
    }
  }

  // ============ 底图 ============

  async setBasemap(basemap: BasemapStr): Promise<void> {
    const layers = this.viewer.imageryLayers;
    layers.removeAll();

    if (basemap === 'satellite') {
      // ESRI World Imagery：免 token 卫星影像
      layers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        })
      );
    } else if (basemap === 'terrain') {
      // 地形渲染模式：纯色底图 + 等高线
      layers.addImageryProvider(
        new Cesium.SingleTileImageryProvider({
          url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII/NaturalEarthII.jpg'),
        })
      );
    } else if (basemap === 'political') {
      layers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
          subdomains: 'abcd',
        })
      );
    } else if (basemap === 'osm') {
      layers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
        })
      );
    }
  }

  // ============ 地形 ============

  async setTerrainExaggeration(value: number): Promise<void> {
    // Cesium 1.107+ 使用 verticalExaggeration
    (this.viewer.scene as unknown as { verticalExaggeration: number }).verticalExaggeration = value;
  }

  async showContour(spacing: number): Promise<void> {
    const globe = this.viewer.scene.globe;
    globe.material = Cesium.Material.fromType('ElevationContour', {
      color: Cesium.Color.fromBytes(255, 100, 0, 255),
      spacing,
      width: 1.5,
    });
  }

  async showElevationRamp(): Promise<void> {
    // 高程分层材质
    const globe = this.viewer.scene.globe;
    globe.material = Cesium.Material.fromType('ElevationRamp', {
      image: this.createElevationRampImage(),
      minimumHeight: -10000,
      maximumHeight: 9000,
    });
  }

  async showSlope(): Promise<void> {
    const globe = this.viewer.scene.globe;
    globe.material = Cesium.Material.fromType('SlopeRamp', {
      image: this.createSlopeRampImage(),
    });
  }

  async showAspect(): Promise<void> {
    const globe = this.viewer.scene.globe;
    globe.material = Cesium.Material.fromType('AspectRamp', {
      image: this.createAspectRampImage(),
    });
  }

  /** 清除地形材质 */
  clearTerrainMaterial(): void {
    this.viewer.scene.globe.material = undefined;
  }

  // ============ 天文可视化 ============

  private astronomyEntities: Cesium.Entity[] = [];
  private rotationActive = false;
  private rotationSpeed = 0;
  private rotationListener: ((clock: Cesium.Clock) => void) | null = null;
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
   * - 每帧实时读取 axisTilt，确保倾角滑块调整后旋转轴立即同步
   * - 不修改 globe.modelMatrix，避免与图层实体错位
   */
  setRotation(enabled: boolean, speed: number): void {
    if (enabled) {
      this.rotationSpeed = speed;
      if (!this.rotationActive) {
        this.rotationActive = true;
        this.rotationListener = () => {
          if (!this.rotationActive) return;
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
    // 具体图层渲染由 React 组件根据 store 状态处理
    // 这里只处理需要 Cesium API 的特殊图层
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
