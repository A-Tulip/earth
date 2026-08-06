/**
 * CesiumCanvas —— Cesium 地球画布 React 组件
 *
 * 只在客户端初始化 Cesium（useEffect 中）。
 * 卸载时 destroy() 释放 WebGL 资源。
 */

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { CesiumController } from './controller';
import { useGeographyStore } from '../state/store';
import { commandBus, registerCommandHandlers } from '../commands/bus';
import { createBasemapProvider, createTerrariumTerrainProvider } from './terrainProviders';
import { createTickThrottle, FpsCounter, getGlobalDegrader, type DegradeConfig, DEGRADE_TIERS } from '../state/PerformanceMonitor';
import { LayerLifeCycleManager, setLayerManagerSingleton } from './LayerLifeCycleManager';

interface CesiumCanvasProps {
  onReady?: (controller: CesiumController) => void;
}

export function CesiumCanvas({ onReady }: CesiumCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CesiumController | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // ================ Q6：启动加载进度分步推进（只在 startupProgress<100 时写入，避免刷新后退时反复触发） ================
    const pushStartup = (p: number, label: string | null) => {
      try {
        const st = useGeographyStore.getState();
        const cur = st.ui.startupProgress ?? 0;
        if (cur >= 100) return;
        const next = Math.max(cur, Math.min(100, Math.round(p)));
        if (next === cur && label === (st.ui.startupLabel ?? null)) return;
        useGeographyStore.setState({
          ui: { ...st.ui, startupProgress: next, startupLabel: label ?? st.ui.startupLabel ?? null },
        });
      } catch { /* 任何写入错误不影响初始化主流程 */ }
    };
    pushStartup(5, '正在初始化环境…');

    // 设置 ion token（可选，使用 OSM 免 token 底图时不需要）
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
    let cancelled = false;

    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }
    pushStartup(16, '正在初始化地球引擎…');

    // 创建 Viewer —— 关闭所有默认 UI，保留纯画布
    // Q2 关键加固：Viewer 创建本身可能失败（WebGL 不可用、容器尺寸为 0 等），加 try-catch 防止白屏
    let viewer: Cesium.Viewer;
    try {
      viewer = new Cesium.Viewer(containerRef.current, {
      // 关闭所有 Cesium 默认 widget
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      navigationInstructionsInitiallyVisible: false,

      // 底图：天地图 WMTS 主用（若有 token），否则 Esri World Imagery
      baseLayer: new Cesium.ImageryLayer(createBasemapProvider('satellite')[0]),

      // 地形：若有 ion token 用世界地形，否则用 AWS Terrarium 免费地形
      terrain: ionToken
        ? Cesium.Terrain.fromWorldTerrain()
        : undefined,

      // Q6 根因修复：3D 模式必须用 GeographicProjection，**不能**用 WebMercator
      // WebMercator 只适合 2D 平面，放到椭球上会造成"东半球贴对、西半球错位"的跨 180° 黑洞
      // 2D/哥伦布视图下 Cesium 内部会把 imagery 自动重投影，因此统一用 GeographicProjection
      mapProjection: new Cesium.GeographicProjection(),

      // 按需渲染（性能优化：静态场景降低 80%+ CPU）
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,

      // 场景设置
      sceneMode: Cesium.SceneMode.SCENE3D,
      msaaSamples: 4,
    });
    } catch (viewerErr) {
      // Viewer 创建失败：显示错误提示，不白屏
      console.error('[CesiumCanvas] Viewer creation failed:', viewerErr);
      pushStartup(100, null);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#f87171;font-size:14px;text-align:center;padding:40px;z-index:10;';
      errDiv.innerHTML = '<div style="font-size:18px;font-weight:600;">地球引擎初始化失败</div>'
        + '<div style="color:#94a3b8;">WebGL 可能被禁用或显卡驱动不兼容。<br/>请尝试：Chrome 地址栏访问 chrome://settings 确认"使用硬件加速"已开启，或换用其他浏览器。</div>'
        + `<div style="color:#64748b;font-size:12px;margin-top:8px;">${viewerErr instanceof Error ? viewerErr.message : String(viewerErr)}</div>`;
      containerRef.current.appendChild(errDiv);
      return;
    }

    // ============== Q6 地球空洞（黑色补丁/瓦片接缝/z-fighting）彻底加固 ==============
    // (0) 底图/地形瓦片加载失败诊断：监听各 imagery layer 的 errorEvent，打印具体失败原因，
    //     帮助定位"空洞"是 网络/CORS/配额 还是 渲染问题。
    //     （若这里刷 `[CesiumCanvas] layer 加载失败`，说明是底图服务被墙/限流，需换国内底图源。）
    try {
      const watchTiles = () => {
        const layers = viewer.imageryLayers;
        for (let i = 0; i < layers.length; i++) {
          try {
            layers.get(i).errorEvent.addEventListener((err: unknown) => {
              const e = err as { message?: string; url?: string; statusCode?: number };
              console.warn(
                `[CesiumCanvas] layer 加载失败 status=${e?.statusCode ?? ''} url=${(e?.url ?? '').slice(0, 140)} msg=${e?.message ?? String(err)}`,
              );
            });
          } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:119', (e as any)?.message ?? e); }
        }
      };
      watchTiles();
      // 后续 setBasemap 动态新增的 layer 也一并监听
      viewer.imageryLayers.layerAdded.addEventListener(() => watchTiles());
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:125', (e as any)?.message ?? e); }
    // (0) 基岩色：默认 Globe 无瓦片处为 BLACK（纯黑），在深空蓝色 Starfield 上就是"黑洞"。
    //     改成带一点点深蓝的基岩色 —— 瓦片没加载完的地方看起来是
    //     一致的真实深色海洋，而不是"破洞"。
    try { (viewer.scene.globe as unknown as { baseColor?: Cesium.Color }).baseColor = Cesium.Color.fromBytes(6, 14, 30, 255); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:129', (e as any)?.message ?? e); }
    // (0b) 关 globe 半透明：半透明会让背面瓦片透过正面看到，视觉上像"镂空"
    try {
      const g = viewer.scene.globe as unknown as { translucency?: { enabled?: boolean } };
      if (g.translucency && typeof g.translucency.enabled === 'boolean') g.translucency.enabled = false;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:134', (e as any)?.message ?? e); }
    // (0c) 隐藏瓦片加载失败的红色错误纹理 + 失败提示
    try { (viewer.scene.globe as unknown as { showTileFailures?: boolean }).showTileFailures = false; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:136', (e as any)?.message ?? e); }
    try { (viewer.scene as unknown as { tileLoadFailureMessage?: boolean }).tileLoadFailureMessage = false; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:137', (e as any)?.message ?? e); }
    // ✅ ISSUE 通用内容贴图修复：如果瓦片 CORS / 403 / 断网 全失败，会看到一个纯深蓝黑的"纯色球"，
    //   用户以为"全都是贴图/没渲染"。这里补一个程序化 Canvas 海洋底纹作为"最后兜底瓦片"：
    //   - 当 imageryLayers 全空或全失败时，显示一个带海洋噪声纹理（非纯色）的底图
    //   - 当真实瓦片加载成功后，它作为 index 0，会盖住这个噪点底（我们放在 index=-1 之前用 `BaseLayerPicker` 的思路 —— 用 ImageryLayer 的 alpha 0 退化为噪点）
    try {
      const w = 512;
      const h = 256;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      // 深蓝海渐变背景
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0e2742');   // 北极附近略浅
      grad.addColorStop(0.5, '#05121f'); // 赤道附近深海
      grad.addColorStop(1, '#0c2238');   // 南极附近略浅
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // 伪随机海洋蓝噪声（非常柔和的噪点，不是雪花）—— 视觉上像"有内容"而非"贴图"
      const img = ctx.getImageData(0, 0, w, h);
      let seed = 12345;
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < img.data.length; i += 4) {
        const jitter = (rand() - 0.5) * 10; // ±5 范围内抖动
        img.data[i]     = Math.max(0, Math.min(255, img.data[i]     + jitter * 0.4));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + jitter * 0.9));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + jitter * 1.2));
      }
      ctx.putImageData(img, 0, 0);
      // 画几个模糊的绿色"示意大陆"色块（低对比度）—— 不代表真实地理，仅仅避免"纯色贴皮球"的视觉
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.filter = 'blur(12px)';
      ctx.fillStyle = '#1c4a2e';
      // 亚欧大陆
      ctx.beginPath(); ctx.ellipse(320, 85, 110, 45, -0.1, 0, Math.PI * 2); ctx.fill();
      // 非洲
      ctx.fillStyle = '#274f2c';
      ctx.beginPath(); ctx.ellipse(275, 145, 40, 50, 0.05, 0, Math.PI * 2); ctx.fill();
      // 美洲
      ctx.fillStyle = '#1f4a30';
      ctx.beginPath(); ctx.ellipse(130, 95, 35, 65, -0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(148, 180, 25, 40, 0.15, 0, Math.PI * 2); ctx.fill();
      // 澳洲
      ctx.fillStyle = '#2a4a30';
      ctx.beginPath(); ctx.ellipse(410, 185, 28, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 转成 Data URL，用 SingleTileImageryProvider 全局一张
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const fallbackProvider = new Cesium.SingleTileImageryProvider({
        url: dataUrl,
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      });
      // 作为"最底层兜底瓦片"：必须放入 index 0（最底），真实瓦片（baseLayer/index 靠后）渲染在其上方。
      // ⚠️ 之前用 addImageryProvider(fallbackProvider) 会追加到【最上层】且 alpha=1，
      //    → 把真实卫星图盖在下面，用户看到的是"假蓝色噪声球"；而真实瓦片加载失败处又露出黑色空洞。
      //    改为插入 index 0：真实瓦片成功 → 盖住兜底；失败 → 兜底透出，不再有黑洞。
      const fbLayer = viewer.imageryLayers.addImageryProvider(fallbackProvider, 0);
      try { (fbLayer as unknown as { _label?: string })._label = '__fallbackOceanNoise__'; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:195', (e as any)?.message ?? e); }
      fbLayer.alpha = 1;
    } catch { /* ignore：如果 fallback 构建失败，保持原来 baseColor 也不会崩溃 */ }
    // (1) 地形深度 vs 球壳/大气层 z-fighting → 关 against-terrain 深度测试
    viewer.scene.globe.depthTestAgainstTerrain = false;
    // (2) 背面剔除关：背面剔除会把视角稍偏背面的椭球面片直接剔除，出现"挖洞"
    viewer.scene.globe.backFaceCulling = false;
    // (2b) Q6 加强：关 debug tile 边框（部分 Cesium 版本默认可能开），避免 seam 视觉
    try { (viewer.scene.globe as unknown as { showTileBoundaries?: boolean }).showTileBoundaries = false; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:203', (e as any)?.message ?? e); }
    // (2c) Q6 加强：启用对数深度缓冲，减少远/近裁剪面比例失衡造成的 z-fighting
    try {
      const sceneAny = viewer.scene as unknown as { logarithmicDepthBuffer?: boolean };
      if (typeof sceneAny.logarithmicDepthBuffer === 'boolean') sceneAny.logarithmicDepthBuffer = true;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:208', (e as any)?.message ?? e); }
    // (3) 收紧近裁剪面：PerspectiveFrustum near public number
    try {
      const f = viewer.camera.frustum as Cesium.PerspectiveFrustum;
      if (typeof f.near === 'number' && f.near < 10) f.near = 10;
      // Q6 加强：远裁剪面不超过 3e9（太阳系外很远物体），减少 z-fighting
      if (typeof f.far === 'number' && (f.far <= 0 || f.far > 3e9)) f.far = 3e9;
    } catch { /* 非 PerspectiveFrustum（2D orthographic）跳过 */ }
    try {
      // 2D 正交投影：near/far 类似处理
      const f2 = viewer.camera.frustum as Cesium.OrthographicFrustum;
      if (typeof f2.near === 'number' && f2.near < 10) f2.near = 10;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:220', (e as any)?.message ?? e); }
    // (4) Sky/地面大气：亮度修正（Q1 曝光根治）
    //     - HDR tonemap pipeline 默认开 → 教学底图偏白/过曝；关掉线性输出更接近真实卫星图
    //     - skyAtmosphere brightnessShift 负 → 边缘大气辉光不刺眼
    //     - groundAtmosphere 配合大气层的亮度/饱和度
    viewer.scene.globe.showGroundAtmosphere = true;
    try {
      const sceneAny = viewer.scene as unknown as {
        highDynamicRange?: boolean;
        tonemapped?: boolean;
        logarithmicDepthBuffer?: boolean;
      };
      if (typeof sceneAny.highDynamicRange === 'boolean') sceneAny.highDynamicRange = false;
      if (typeof sceneAny.tonemapped === 'boolean') sceneAny.tonemapped = false;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:234', (e as any)?.message ?? e); }
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      // ⚠️ 从 -0.12 → -0.05：之前压暗太狠，大气临边衔接时变成一圈死黑轮廓（视觉上的"黑洞边缘"）
      viewer.scene.skyAtmosphere.brightnessShift = -0.05;
      viewer.scene.skyAtmosphere.saturationShift = 0.12; // Q5: 稍提升饱和度，青蓝感
      viewer.scene.skyAtmosphere.hueShift = -0.02; // Q5: 略偏青蓝（-0.02 ≈ 青方向）
    }
    // (4b) Globe 级 atmosphere 亮度/饱和度（Cesium 1.120+ 暴露了 Globe.atmosphere* 参数）
    try {
      const globeAny = viewer.scene.globe as unknown as {
        atmosphereBrightnessShift?: number;
        atmosphereSaturationShift?: number;
        atmosphereHueShift?: number;
        showWaterEffect?: boolean;
      };
      // 同步 -0.12 → -0.05，避免临边黑洞圈
      if (typeof globeAny.atmosphereBrightnessShift === 'number') globeAny.atmosphereBrightnessShift = -0.05;
      if (typeof globeAny.atmosphereSaturationShift === 'number') globeAny.atmosphereSaturationShift = 0.10; // Q5
      if (typeof globeAny.atmosphereHueShift === 'number') globeAny.atmosphereHueShift = -0.02; // Q5
      // 关水面高光：教学用的 Esri/天地图/高德卫星底图都已经自带水面纹理，动态水面高光会让海洋局部发亮（Q1 另一曝光源）
      if (typeof globeAny.showWaterEffect === 'boolean') globeAny.showWaterEffect = false;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:256', (e as any)?.message ?? e); }
    // (5) Cesium 原生 SkyBox：直接置 null（比 show=false 更干净，避免哪怕 show=false 的对象占资源）
    try { (viewer.scene as unknown as { skyBox?: Cesium.SkyBox | null }).skyBox = null; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:258', (e as any)?.message ?? e); }
    // (6) Cesium 原生 Sun/Moon：
    //    ⚠️ ISSUE-1b 浮动圆盘根因：scene.sun = null / scene.moon = null 在部分 Cesium 版本上是只读属性，
    //       静默赋值失败后，Cesium 仍然会在镜头靠近太阳/月亮方向时绘制巨大的 billboard 圆（无光照材质，
    //       看起来就是一个带纹理的倾斜黑色圆盘漂浮在地球外面 / 紧贴北极）。
    //       三重防御：(a) try/catch 包 null 赋值 (b) 若属性是 getter-only 则 fallback 设 .show = false
    //                (c) 启动后立即 removeAll 非业务实体 + clear 场景里的多余 primitive
    try { (viewer.scene as unknown as { sun?: unknown }).sun = null; } catch {
      try { const s = (viewer.scene as unknown as { sun?: { show?: boolean } }).sun; s && (s.show = false); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:266', (e as any)?.message ?? e); }
    }
    try { (viewer.scene as unknown as { moon?: unknown }).moon = null; } catch {
      try { const m = (viewer.scene as unknown as { moon?: { show?: boolean } }).moon; m && (m.show = false); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:269', (e as any)?.message ?? e); }
    }
    // ISSUE-1b 第二层清理：Cesium 在 Viewer 构造函数内会默认创建一些 primitives/entities（比如
    //   调试球体、label 集合、旧版本 moon/sun primitive）。构造完成后 clearAll 未知内容，
    //   只保留我们显式添加的 globe + imageryLayer
    try {
      // 清理所有 Cesium 初始实体（太阳 billboard / 调试球体 / 卫星纹理等）
      viewer.entities.removeAll();
      // 清理所有非 globe 相关 primitive
      const pc = viewer.scene.primitives;
      for (let i = pc.length - 1; i >= 0; i--) {
        try { pc.remove(pc.get(i)); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:280', (e as any)?.message ?? e); }
      }
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:282', (e as any)?.message ?? e); }
    // (7) 统一背景色（透传，和 Starfield 深蓝衔接）
    viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;

    // ============== Q8 相机范围 + 地表细节 ==============
    // (1) 允许街景级 zoom：minimum 30m（能看清单行马路），maximum 1.2 地月距离（足够看地球全局）
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 30;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 400_000_000;
    // 允许穿越地形到街景高度（教学视角不受地形限高阻塞）
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
    // Q8: 重置相机 lookAt 绑定，避免锁定目标导致自由旋转受限（API: camera.lookAtTransform）
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    // (2) 屏幕空间误差 SSE 更紧：默认 Cesium=2，此处 1.4（越紧纹理越清晰，街景瓦片越愿意拿高 LOD）
    try {
      const globeAny = viewer.scene.globe as unknown as { maximumScreenSpaceError?: number };
      if (typeof globeAny.maximumScreenSpaceError === 'number') {
        globeAny.maximumScreenSpaceError = 1.4;
      }
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:300', (e as any)?.message ?? e); }
    // (3) Globe 光照细节：normal-based shading（让地形在任何底图下都更有"皮纹"质感）
    try {
      (viewer.scene.globe as unknown as { showSkirts?: boolean }).showSkirts = true;
    } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:304', (e as any)?.message ?? e); }

    // ============== LayerLifeCycleManager 单例注入 ==============
    // Q2 同步创建（不用动态 import）：确保 terrain 异步加载 schedule 之前单例已就绪
    const layerMgr = new LayerLifeCycleManager(viewer);
    setLayerManagerSingleton(layerMgr);
    pushStartup(40, '正在加载底图瓦片…');

    // 隐藏 Cesium logo（合法：Apache 2.0 不强制，但保留 credit 容器用于数据源署名）
    const creditContainer = viewer.creditDisplay.container;
    (creditContainer as HTMLElement).style.display = 'none';

    // 无 ion token 时使用 AWS Terrarium 免费地形（CC0 Public Domain）
    // 椭球地形会导致等高线/高程分层/坡度/地形夸张全部失效
    // Q2：terrain 切换全部走 layerMgr.schedule('terrain')，触发 LoadingOverlay 防止蓝色裸露
    if (!ionToken) {
      // 先用椭球启动（保证地球立即显示），异步替换为 Terrarium 地形
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      useGeographyStore.getState().setTerrain({ available: false });
      void layerMgr.schedule('terrain', async () => {
        try {
          const terrariumProvider = await createTerrariumTerrainProvider();
          if (cancelled) return;
          viewer.terrainProvider = terrariumProvider;
          useGeographyStore.getState().setTerrain({ available: true });
        } catch {
          // 保持椭球地形，terrain.available 已为 false
        }
      });
    } else {
      // 有 ion token：WorldTerrain 内部会异步加载，同样包 schedule 触发 LoadingOverlay
      void layerMgr.schedule('terrain', async () => {
        try {
          // 等待 Ion WorldTerrain ready（从WorldTerrain返回的是Terrain对象，内部readyPromise）
          const tAny = viewer.terrainProvider as unknown as {
            readyPromise?: Promise<unknown>;
            ready?: boolean;
          };
          if (tAny.ready === false && tAny.readyPromise) {
            await Promise.race([tAny.readyPromise, new Promise((r) => setTimeout(r, 6000))]);
          }
        } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:345', (e as any)?.message ?? e); }
        if (!cancelled) useGeographyStore.getState().setTerrain({ available: true });
      });
    }

    // 光照默认关闭（避免夜半球全黑影响地面显示），晨昏线图层开启时再启用
    viewer.scene.globe.enableLighting = false;
    // 默认使用 SunLight（无方向阴影），twilight 开启时切换为 DirectionalLight
    viewer.scene.light = new Cesium.SunLight();

    // 雾化配置：低 tier 时关闭（T2/T3），其他档保持低密度自然过渡
    if (viewer.scene.fog) {
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.0001;
    }

    // 初始视角：中国上空（和 controller.resetToChina 的 RESET_CAMERA 保持一致）
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(116.4, 35.0, 15_000_000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
    });

    const controller = new CesiumController(viewer);
    controllerRef.current = controller;

    // 注册命令处理器
    registerCommandHandlers();
    commandBus.setContext({ cesium: controller });
    pushStartup(62, '正在加载地形数据…');

    // Q7：若有高德 key，启动时切到 高德卫星（国内底图街景级更稳）
    // 注意：延迟到首帧渲染完成后再切，避免初始化期间 scene 未就绪导致"渲染失败"弹窗
    const amapKey = import.meta.env.VITE_AMAP_KEY;
    if (amapKey) {
      // 等首帧渲染完成后再调度底图切换（通过 postRender 一次性事件）
      let amapSwitched = false;
      const switchToAmap = () => {
        if (amapSwitched || cancelled) return;
        amapSwitched = true;
        try { offAmap(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:388', (e as any)?.message ?? e); }
        void Promise.resolve().then(async () => {
          if (cancelled) return;
          try {
            await controller.setBasemap('amapSatellite');
            useGeographyStore.getState().setBasemap('amapSatellite');
          } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:394', (e as any)?.message ?? e); }
        });
      };
      const offAmap = viewer.scene.postRender.addEventListener(switchToAmap);
      // 兜底：2s 后强制切换
      window.setTimeout(switchToAmap, 2000);
    }

    // 应用初始图层状态：让 store 中默认 true 的图层真正渲染
    const initStore = useGeographyStore.getState();
    if (initStore.astronomy.axis) controller.updateLayer('axis', true);
    if (initStore.astronomy.directPoint) controller.updateLayer('directPoint', true);
    if (initStore.astronomy.rotation) controller.updateLayer('rotation', true);
    viewer.scene.requestRender();

    // ======== 性能优化（issue #19：rAF handler 耗时） ========
    // 1. requestRender 节流：每 16ms（~60FPS）最多一次，避免连续 requestRender
    const renderThrottle = createTickThrottle(16);
    // 2. 直射点更新节流：每 2s 一次，直射点经度变化极慢（15°/小时），无需每帧
    const directPointThrottle = createTickThrottle(2000);
    // 3. FPS 计数器：始终运行（降级系统需要 FPS 采样，不只是 DEV 显示）
    const fpsCounter = new FpsCounter();
    const degrader = getGlobalDegrader();
    const devMode = import.meta.env.DEV ?? false;

    // ============ Degrade 策略应用：把 config 映射到 Cesium 真实 API ============
    const applyDegrade = (cfg: DegradeConfig): void => {
      try {
        // (A) resolutionScale：Cesium 全局像素比（影响 framebuffer → canvas 分辨率）
        (viewer as unknown as { resolutionScale?: number }).resolutionScale = cfg.cesiumPixelRatio;
        // (A1) Q1 曝光修复：HDR tonemap pipeline 始终关，保证底图颜色线性、不发白
        try {
          const sceneAny = viewer.scene as unknown as {
            highDynamicRange?: boolean; tonemapped?: boolean;
          };
          if (typeof sceneAny.highDynamicRange === 'boolean') sceneAny.highDynamicRange = false;
          if (typeof sceneAny.tonemapped === 'boolean') sceneAny.tonemapped = false;
        } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:431', (e as any)?.message ?? e); }
        // (B) Globe tileCacheSize（若暴露了 setTileCacheSize / _tileCacheSize）
        const globe = viewer.scene.globe as unknown as {
          tileCacheSize?: number; _tileCacheSize?: number;
          tileCacheBytes?: number; _tileCacheBytes?: number;
          maximumScreenSpaceError?: number;
        };
        const curModeIs2D = viewer.scene.mode === Cesium.SceneMode.SCENE2D;
        if (typeof globe.maximumScreenSpaceError === 'number') {
          // SSE 越大 = 细节越低，渲染越便宜
          // Q1b 2D 模式：平面瓦片开销低 → 全 tier 收紧 SSE（更清晰，2D 街景级细节更好）
          if (curModeIs2D) {
            globe.maximumScreenSpaceError = Math.max(0.8, 1.0 + cfg.tier * 0.8); // tier0: 1.0, 1: 1.8, 2: 2.6, 3: 3.4
          } else {
            globe.maximumScreenSpaceError = 2 + cfg.tier * 2; // tier0: 2, 1:4, 2:6, 3:8
          }
        }
        try {
          // Q1b 2D 模式：tile 是平面，缓存压力小，cache 容量 ×1.5
          const wantCache = curModeIs2D ? Math.round(cfg.globeTileCacheSize * 1.5) : cfg.globeTileCacheSize;
          if (typeof globe.tileCacheSize === 'number') globe.tileCacheSize = wantCache;
          else if (typeof globe._tileCacheSize === 'number') globe._tileCacheSize = wantCache;
        } catch { /* 部分版本 setter 不存在 */ }
        // (C) Fog density：越高雾越近，远处瓦片请求越少
        if (viewer.scene.fog) {
          viewer.scene.fog.enabled = true;
          viewer.scene.fog.density = cfg.fogDensity;
        }
        // (D) 地形夸张倍数：越低 → 顶点变形越小
        try {
          const st = useGeographyStore.getState();
          const lessonActive = !!st.lesson?.activeLessonId || (window as any)._lessonActiveForExaggerationGuard;
          const perfSkipWrite = lessonActive;
          if (!perfSkipWrite) {
            const terrainExag = st.terrain?.exaggeration;
            if (terrainExag != null) {
              useGeographyStore.setState({
                terrain: { ...st.terrain, exaggeration: cfg.terrainExaggeration },
              });
            }
            (viewer.scene.globe as unknown as { _terrainExaggeration?: number })._terrainExaggeration = cfg.terrainExaggeration;
          } else {
            (viewer.scene.globe as unknown as { _terrainExaggeration?: number })._terrainExaggeration = cfg.terrainExaggeration;
          }
        } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:475', (e as any)?.message ?? e); }
        // (E) 后处理：FXAA/Bloom 由 DegradeConfig 控制；Bloom 默认全关（Q1 曝光修复）
        try {
          const p = (viewer.scene.postProcessStages as unknown as {
            fxaa?: Cesium.PostProcessStage | undefined;
            bloom?: Cesium.PostProcessStageComposite | undefined;
          });
          // Q1b 2D 模式：平面瓦片锯齿更明显（国界/海岸线等），全 tier 强制开 FXAA
          const fxaaWant = curModeIs2D ? true : cfg.fxaaEnabled;
          if (p.fxaa) (p.fxaa as unknown as { enabled?: boolean }).enabled = fxaaWant;
          if (p.bloom) (p.bloom as unknown as { enabled?: boolean }).enabled = cfg.bloomEnabled;
        } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:486', (e as any)?.message ?? e); }
        // (F) 大气层：低档关掉，省全屏后处理 pass；**2D 模式下一律关**（大气层仅 3D/哥伦布有意义）
        try {
          const curMode = viewer.scene.mode;
          const anyAtm = cfg.tier <= 1 && curMode !== Cesium.SceneMode.SCENE2D;
          viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = anyAtm);
          viewer.scene.globe.showGroundAtmosphere = anyAtm;
        } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:493', (e as any)?.message ?? e); }
        // (G) 太阳/月亮：任何 tier 都关闭 Cesium 原生太阳 billboard（Q8：消除天空日食大黑圆/空洞；
        //         DirectionalLight 不需要 sun.show 就能构建；太阳直射点标注我们自己有 astro-direct-point 实体
        //         SunLight 也不依赖 sun.show —— 它只是读取 sun 的方向向量，而方向向量仍可从 scene.sun.positionWC 读取
        try { viewer.scene.sun && (viewer.scene.sun.show = false); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:497', (e as any)?.message ?? e); }
        try { viewer.scene.moon && (viewer.scene.moon.show = false); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:498', (e as any)?.message ?? e); }
        // (H) 把 solar 像素比上限挂到 window 全局（SolarEngine 懒加载时读取）
        (window as unknown as { _solarPixelRatioClamp?: number })._solarPixelRatioClamp = cfg.solarPixelRatioClamp;
        // (I) 把 labelLODFactor 暴露给 CesiumLayerSync applyLabelLOD()
        (window as unknown as { _labelLODFactor?: number })._labelLODFactor = cfg.labelLODFactor;
        // (J) Starfield.tsx 读取 _starfieldAnimated 决定是否画 twinkle + meteors
        (window as unknown as { _starfieldAnimated?: boolean })._starfieldAnimated = cfg.starfieldAnimated;

        viewer.scene.requestRender();
      } catch { /* noop：任何失败不影响渲染主线 */ }
    };

    // 先应用一次初始档（tier0）
    applyDegrade(degrader.config);
    // 订阅后续 tier 变化
    const unsubDegrade = degrader.subscribe((t) => {
      applyDegrade(DEGRADE_TIERS[t.next]);
      if (devMode) {
        // eslint-disable-next-line no-console
        console.info(`[perf] degrade ${t.prev} → ${t.next}  avg=${t.avgFps.toFixed(1)} min=${t.minFps.toFixed(1)}`);
      }
    });

    // 把 FPS 样本喂给 Degrader：subscribe 的 fps 已经是 500ms 一次
    const unsubDegradeFeed = fpsCounter.subscribe((fps, ms) => {
      // 也刷新 window._geographyFps 给 FpsDisplay 组件
      const w = window as unknown as { _geographyFps?: { fps: number; ms: number; tier?: number } };
      w._geographyFps = { fps, ms, tier: degrader.tier };
      // 喂给 degrader 做自适应评估
      degrader.feed(fps, ms);
    });

    // 时钟推进时请求重渲染，并动态更新太阳直射点位置（跟随 UTC 时间）
    viewer.clock.onTick.addEventListener(() => {
      fpsCounter.tick();
      // 16ms 节流：requestRender 在连续场景下会被内部合并，仍可避免多余调用
      if (renderThrottle()) {
        viewer.scene.requestRender();
      }
      // 直射点节流：2s 更新一次足够平滑（15°/小时 ≈ 0.004°/s，2s 仅 0.008°）
      if (directPointThrottle()) {
        controller.updateDirectPointDynamic();
      }
    });

    // 订阅 astronomy.rotation 变化，同步 controller（修复 animation.play/pause 解耦 bug）
    const unsubscribeRotation = useGeographyStore.subscribe(
      (s) => s.astronomy.rotation,
      (rotating) => {
        const speed = useGeographyStore.getState().rotationSpeed;
        controller.setRotation(rotating, speed);
      },
    );

    // 订阅 astronomy.axis 变化，同步地轴线渲染
    const unsubscribeAxis = useGeographyStore.subscribe(
      (s) => s.astronomy.axis,
      (visible) => controller.updateLayer('axis', visible),
    );

    // 订阅 axisTilt 变化，实时更新地轴线
    const unsubscribeTilt = useGeographyStore.subscribe(
      (s) => s.axisTilt,
      () => {
        if (useGeographyStore.getState().astronomy.axis) {
          controller.updateLayer('axis', true);
        }
      },
    );

    // 订阅时间维度状态变化，驱动 Cesium 时钟
    const unsubscribeTime = useGeographyStore.subscribe(
      (s) => s.time,
      (time) => {
        if (time.active) {
          controller.setTimeDimension(time.startTime, time.endTime, time.multiplier, time.isPlaying);
        } else {
          controller.clearTimeDimension();
        }
      },
    );

    onReady?.(controller);
    // Q6：controller、单例、命令处理器、订阅均就绪 → 推到 92%（最后 8% 等首帧渲染）
    pushStartup(92, '正在完成最终渲染…');
    // Q6：等 Cesium 真正完成"首次渲染+首瓦片+地形ready"后再推到 100%，
    //     避免 AppLoader 刚消失地球还是蓝色椭球。用 postRender 一次性事件 + 双保险 timeout
    (() => {
      let done = false;
      const finalize = () => {
        if (done) return;
        done = true;
        try { off(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:590', (e as any)?.message ?? e); }
        try { window.clearTimeout(tOut); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:591', (e as any)?.message ?? e); }
        pushStartup(100, null);
      };
      const off = viewer.scene.postRender.addEventListener(() => {
        // 首帧之后再延迟 1 帧，确保瓦片/地形/大气层都有机会真正 draw 到 framebuffer
        try { window.setTimeout(finalize, 16); } catch { finalize(); }
      });
      const tOut = window.setTimeout(finalize, 5000);
    })();

    // ================ Q11：全局未处理错误 / Promise rejection 拦截器，防止 React 白屏 ================
    const onGlobalError = (ev: ErrorEvent) => {
      // 拦截 Cesium 内部 render 错误，防止 React root 被卸载
      const msg = ev?.message ?? String(ev);
      if (typeof msg === 'string' && (msg.includes('Cesium') || msg.includes('tile') || msg.includes('render') || msg.includes('WebGL'))) {
        console.warn('[CesiumCanvas] swallowed render error:', msg);
        try { ev.preventDefault?.(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:607', (e as any)?.message ?? e); }
        try { viewer.scene.requestRender(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:608', (e as any)?.message ?? e); }
      }
    };
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = (ev as unknown as { reason?: unknown }).reason;
      const rStr = reason instanceof Error ? reason.message : String(reason ?? '');
      // 忽略已知 Cesium/网络瓦片类 Promise 异常（不致命，白屏更严重）
      if (rStr && /Cesium|tile|ImageryProvider|Terrain|network|fetch|CORS|404|429|5\d\d/i.test(rStr)) {
        console.warn('[CesiumCanvas] swallowed unhandled rejection:', rStr);
        try { ev.preventDefault?.(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumCanvas.tsx:617', (e as any)?.message ?? e); }
      }
    };
    window.addEventListener('error', onGlobalError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      cancelled = true;
      window.removeEventListener('error', onGlobalError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      unsubscribeTime();
      unsubscribeRotation();
      unsubscribeAxis();
      unsubscribeTilt();
      unsubDegrade();
      unsubDegradeFeed();
      // 清理全局 FPS/degrade 数据
      const w = window as unknown as {
        _geographyFps?: unknown;
        _solarPixelRatioClamp?: unknown;
        _labelLODFactor?: unknown;
        _starfieldAnimated?: unknown;
        _starfieldAnimate?: unknown;
      };
      delete w._geographyFps;
      delete w._solarPixelRatioClamp;
      delete w._labelLODFactor;
      delete w._starfieldAnimated;
      delete w._starfieldAnimate;
      commandBus.setContext({ cesium: null });
      controller.destroy();
      controllerRef.current = null;
    };
  }, [onReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0"
      // ✅ ISSUE-1a：Cesium 容器背景必须完全透明！原代码写了不透明 radial-gradient，会把 z-[-1] 的 Starfield 星空 + 星云 + 流星 **完全盖死**，
      //    导致用户说"星空背景全部没有了"。背景渐变应该在底层（Starfield / body）去画。Cesium 只负责地球+大气层+实体，不画背景。
      tabIndex={-1}
    />
  );
}
