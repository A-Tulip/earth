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

      // 底图：ESRI World Imagery（免 token 卫星影像）
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        })
      ),

      // 地形：若有 ion token 用世界地形，否则用椭球（无 terrain 选项）
      terrain: ionToken
        ? Cesium.Terrain.fromWorldTerrain()
        : undefined,

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

    // 无 ion token 时使用椭球地形（免 token 回退）
    if (!ionToken) {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
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

    // 时钟推进时请求重渲染，并动态更新太阳直射点位置（跟随 UTC 时间）
    viewer.clock.onTick.addEventListener(() => {
      viewer.scene.requestRender();
      controller.updateDirectPointDynamic();
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
      unsubscribeTime();
      unsubscribeRotation();
      unsubscribeAxis();
      unsubscribeTilt();
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
