/**
 * SolarSystemCanvas —— 太阳系视图 React 组件
 *
 * 按需挂载：当 store.solarSystemActive === true 时显示，
 * 替代 CesiumCanvas（两者通过 Scene Orchestrator 切换）。
 *
 * Three.js 仅承担"脱离地理坐标系的特殊场景"，
 * 真实地球、地形、地图、影像仍由 CesiumJS 负责。
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SolarSystemEngine } from './engine';
import { useGeographyStore } from '../state/store';

interface SolarSystemCanvasProps {
  onReady?: (engine: SolarSystemEngine) => void;
}

export function SolarSystemCanvas({ onReady }: SolarSystemCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SolarSystemEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000510);

    // 相机
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );

    // 渲染器
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);

    // OrbitControls：让用户可以拖动旋转视角、滚轮缩放
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.6;
    // 覆盖太阳到海王星的观察范围
    controls.minDistance = 8;
    controls.maxDistance = 400;
    // 初始 target 设在太阳位置（场景原点）
    controls.target.set(0, 0, 0);
    controls.update();

    // 引擎
    const engine = new SolarSystemEngine(scene, camera, renderer);
    engine.setControls(controls);
    // init 异步加载真实纹理，但不阻塞——先用程序化纹理渲染
    engine.init().catch(() => {
      // 纹理加载失败保持程序化纹理，课堂不中断
    });
    engine.start();
    engineRef.current = engine;

    // 订阅速度倍率
    const unsubSpeed = useGeographyStore.subscribe(
      (s) => s.revolutionSpeed,
      (speed) => engine.setSpeed(speed),
      { fireImmediately: true },
    );

    onReady?.(engine);

    // 窗口大小变化
    const onResize = () => {
      engine.resize(window.innerWidth, window.innerHeight);
      controls.update();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      unsubSpeed();
      engine.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
      engineRef.current = null;
    };
  }, [onReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0"
      style={{ background: '#000510' }}
    />
  );
}
