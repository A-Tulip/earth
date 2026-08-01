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
import { setLayerManagerSingleton } from './LayerLifeCycleManager';

interface CesiumCanvasProps {
  onReady?: (controller: CesiumController) => void;
}

export function CesiumCanvas({ onReady }: CesiumCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CesiumController | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 设置 ion token（可选，使用 OSM 免 token 底图时不需要）
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
    let cancelled = false;

    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }

    // 创建 Viewer —— 关闭所有默认 UI，保留纯画布
    const viewer = new Cesium.Viewer(containerRef.current, {
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

      // 关键修复：2D 模式使用 Web Mercator 投影，匹配主流瓦片服务（OSM/CARTO/Esri/天地图 vec_w）
      // 默认 GeographicProjection 会导致 2D 模式瓦片错位/不请求
      mapProjection: new Cesium.WebMercatorProjection(),

      // 按需渲染（性能优化：静态场景降低 80%+ CPU）
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,

      // 场景设置
      sceneMode: Cesium.SceneMode.SCENE3D,
      msaaSamples: 4,
    });

    // ============== 地球模型"空洞"（黑色补丁）修复 ==============
    // 1. 关闭 against-terrain 深度测试，避免地形深度与球壳/大气层产生 z-fighting
    viewer.scene.globe.depthTestAgainstTerrain = false;
    // 2. 收紧近裁剪面：默认 1m 太近会把球壳内部的透明面推进 frustum，产生"挖洞"感
    try {
      const camera = viewer.camera;
      const fr = (camera.frustum as unknown as { near?: number; far?: number; _near?: number });
      if (typeof fr.near === 'number' && fr.near < 10) {
        fr.near = 10;
      }
      if (typeof fr._near === 'number' && fr._near < 10) {
        fr._near = 10;
      }
    } catch { /* noop: 部分 frustum 类型字段不同，不强制 */ }

    // ============== LayerLifeCycleManager 单例注入 ==============
    // 必须在任何图层调度 / SceneMode morph 之前注入，保证调度互斥生效
    import('./LayerLifeCycleManager').then(({ LayerLifeCycleManager }) => {
      if (cancelled) return;
      setLayerManagerSingleton(new LayerLifeCycleManager(viewer));
    }).catch(() => { /* ignore */ });

    // 隐藏 Cesium logo（合法：Apache 2.0 不强制，但保留 credit 容器用于数据源署名）
    const creditContainer = viewer.creditDisplay.container;
    (creditContainer as HTMLElement).style.display = 'none';

    // 无 ion token 时使用 AWS Terrarium 免费地形（CC0 Public Domain）
    // 椭球地形会导致等高线/高程分层/坡度/地形夸张全部失效
    if (!ionToken) {
      // 先用椭球启动（保证地球立即显示），异步替换为 Terrarium 地形
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      useGeographyStore.getState().setTerrain({ available: false });
      void (async () => {
        try {
          const terrariumProvider = await createTerrariumTerrainProvider();
          if (cancelled) return;
          viewer.terrainProvider = terrariumProvider;
          useGeographyStore.getState().setTerrain({ available: true });
        } catch {
          // 保持椭球地形，terrain.available 已为 false
        }
      })();
    } else {
      useGeographyStore.getState().setTerrain({ available: true });
    }

    // 光照默认关闭（避免夜半球全黑影响地面显示），晨昏线图层开启时再启用
    viewer.scene.globe.enableLighting = false;
    // 默认使用 SunLight（无方向阴影），twilight 开启时切换为 DirectionalLight
    viewer.scene.light = new Cesium.SunLight();

    // 渲染增强：地面大气 + 天空大气，提升地球边缘与太空过渡质感
    viewer.scene.globe.showGroundAtmosphere = true;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      // 增强天空大气亮度，让地球边缘光晕更明显
      viewer.scene.skyAtmosphere.brightnessShift = 0.4;
    }

    // ============ 宇宙背景：星空 + 太阳 + 月亮 ============
    // 深空背景色（与容器 #0a0f1a 一致，避免 SkyBox 边缘接缝）
    viewer.scene.backgroundColor = Cesium.Color.fromBytes(10, 15, 26, 255);

    // 显式启用 Cesium 默认 SkyBox（程序化星点），保持星空可见
    if (viewer.scene.skyBox) {
      viewer.scene.skyBox.show = true;
    }

    // 显式启用太阳：可见 + 影响光照
    if (viewer.scene.sun) {
      viewer.scene.sun.show = true;
      // 太阳辉光大小（Cesium 默认 sunGlowBand 较小，调大更醒目）
      try {
        (viewer.scene.sun as unknown as { sunGlowBand?: number }).sunGlowBand = 3.0;
      } catch {
        // 不同版本字段名差异，忽略设置失败
      }
    }

    // 显式启用月亮（Cesium 内置月相计算，随时间变化）
    if (viewer.scene.moon) {
      viewer.scene.moon.show = true;
    }

    // 配置雾化：远距离星空仍可见，近景地球边缘自然过渡
    if (viewer.scene.fog) {
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.0001; // 低密度保留星空
    }

    // 初始视角：中国上空
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
        // (B) Globe tileCacheSize（若暴露了 setTileCacheSize / _tileCacheSize）
        const globe = viewer.scene.globe as unknown as {
          tileCacheSize?: number; _tileCacheSize?: number;
          tileCacheBytes?: number; _tileCacheBytes?: number;
          maximumScreenSpaceError?: number;
        };
        if (typeof globe.maximumScreenSpaceError === 'number') {
          // SSE 越大 = 细节越低，渲染越便宜
          globe.maximumScreenSpaceError = 2 + cfg.tier * 2; // tier0: 2, 1:4, 2:6, 3:8
        }
        try {
          if (typeof globe.tileCacheSize === 'number') globe.tileCacheSize = cfg.globeTileCacheSize;
          else if (typeof globe._tileCacheSize === 'number') globe._tileCacheSize = cfg.globeTileCacheSize;
        } catch { /* 部分版本 setter 不存在 */ }
        // (C) Fog density：越高雾越近，远处瓦片请求越少
        if (viewer.scene.fog) {
          viewer.scene.fog.enabled = true;
          viewer.scene.fog.density = cfg.fogDensity;
        }
        // (D) 地形夸张倍数：越低 → 顶点变形越小
        try {
          const terrainExag = useGeographyStore.getState().terrain?.exaggeration;
          if (terrainExag != null) {
            useGeographyStore.setState({
              terrain: { ...useGeographyStore.getState().terrain, exaggeration: cfg.terrainExaggeration },
            });
          }
          (viewer.scene.globe as unknown as { _terrainExaggeration?: number })._terrainExaggeration = cfg.terrainExaggeration;
        } catch { /* ignore */ }
        // (E) MSAA：Cesium 没有运行时改 MSAA 的官方 API，但我们已经把 viewer 初始化时的 msaaSamples 根据 tier0 设为 4；
        // 降级时把后处理辉光关掉（若启用了 FXAA/Bloom）
        try {
          const p = (viewer.scene.postProcessStages as unknown as {
            fxaa?: Cesium.PostProcessStage | undefined;
            bloom?: Cesium.PostProcessStageComposite | undefined;
          });
          if (p.fxaa) (p.fxaa as unknown as { enabled?: boolean }).enabled = cfg.tier <= 1;
          if (p.bloom) (p.bloom as unknown as { enabled?: boolean }).enabled = cfg.tier <= 0;
        } catch { /* ignore */ }
        // (F) 大气层：低档关掉，省全屏后处理 pass
        try { viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = cfg.tier <= 1); } catch { /* ignore */ }
        try { viewer.scene.globe.showGroundAtmosphere = cfg.tier <= 1; } catch { /* ignore */ }
        // (G) 太阳/月亮辉光：低档只留 sun（光照需要），月亮隐藏
        try { viewer.scene.sun && (viewer.scene.sun.show = cfg.tier <= 2); } catch { /* ignore */ }
        try { viewer.scene.moon && (viewer.scene.moon.show = cfg.tier <= 1); } catch { /* ignore */ }
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

    return () => {
      cancelled = true;
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
      };
      delete w._geographyFps;
      delete w._solarPixelRatioClamp;
      delete w._labelLODFactor;
      delete w._starfieldAnimated;
      commandBus.setContext({ cesium: null });
      controller.destroy();
      controllerRef.current = null;
    };
  }, [onReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0"
      style={{ background: '#0a0f1a' }}
    />
  );
}
