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
import { createTickThrottle, FpsCounter } from '../state/PerformanceMonitor';

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
      baseLayer: new Cesium.ImageryLayer(createBasemapProvider('satellite')),

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
    // 3. FPS 计数器：开发模式用于性能监控
    const fpsCounter = new FpsCounter();
    const devMode = import.meta.env.DEV ?? false;

    // FPS 订阅：更新到 window._geographyFps 供 FpsDisplay 组件读取
    const unsubFps = fpsCounter.subscribe((fps, ms) => {
      const w = window as unknown as { _geographyFps?: { fps: number; ms: number } };
      w._geographyFps = { fps, ms };
    });

    // 时钟推进时请求重渲染，并动态更新太阳直射点位置（跟随 UTC 时间）
    viewer.clock.onTick.addEventListener(() => {
      if (devMode) {
        fpsCounter.tick();
      }
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
      unsubFps();
      // 清理全局 FPS 数据
      const w = window as unknown as { _geographyFps?: unknown };
      delete w._geographyFps;
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
