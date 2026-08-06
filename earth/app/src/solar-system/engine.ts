/**
 * SolarSystemEngine —— 太阳系仿真引擎（Three.js）
 *
 * 职责：太阳本体+辉光、8大行星程序化纹理、椭圆轨道、土星环、Bloom 后处理。
 * 仅承担"脱离地理坐标系的特殊场景"，真实地球由 CesiumJS 负责。
 *
 * 迁移自 src/engines/concept/solar-system.js，改进：
 * - TypeScript 类型安全
 * - 自转速度使用真实 dayLength（修复旧版统一 0.5 的缺陷）
 * - 金星/天王星逆向自转
 * - 程序化纹理保留（无需外部素材，回退优先）
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PLANET_DATA,
  PlanetData,
  SCALE_FACTORS,
  scaledRadius,
  scaledDistance,
} from '../data/planets';
import { createTickThrottle } from '../state/PerformanceMonitor';
import {
  loadPlanetTexture,
  loadSunTexture,
  loadSaturnRingTexture,
  loadStarsTexture,
} from './texture-loader';

interface PlanetMesh {
  data: PlanetData;
  mesh: THREE.Mesh;
  orbitAngle: number;
  orbitSpeed: number;
  rotationSpeed: number;
}

export class SolarSystemEngine {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private group: THREE.Group;
  private planets: PlanetMesh[] = [];
  private orbits: THREE.Line[] = [];
  private sun: THREE.Mesh | null = null;
  private sunGlow: THREE.Sprite | null = null;
  private composer: EffectComposer | null = null;
  private time = 0;
  private speedMultiplier = 1;
  private animationId: number | null = null;
  private clock = new THREE.Clock();
  // OrbitControls：由 SolarSystemCanvas 注入，engine 在 update 中调用 update()
  private controls: OrbitControls | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /** 初始化太阳系：太阳、行星、轨道、后处理（异步加载真实纹理） */
  async init(): Promise<void> {
    // 先用程序化纹理同步创建场景（立即可见）
    this.createSun();
    this.createPlanets();
    this.createOrbits();
    this.setupPostprocessing();
    this.setupCamera();

    // 异步加载真实纹理，加载完成后替换（不阻塞首屏）
    this.loadRealTextures().catch(() => {
      // 全部失败时保持程序化纹理，课堂不中断
    });
  }

  /** 异步加载真实纹理（Solar System Scope, CC BY 4.0） */
  private async loadRealTextures(): Promise<void> {
    // 星空背景
    const starsTex = await loadStarsTexture();
    if (starsTex) {
      this.scene.background = starsTex;
    }

    // 太阳纹理
    if (this.sun) {
      const sunTex = await loadSunTexture(0xffaa33);
      (this.sun.material as THREE.MeshBasicMaterial).map = sunTex;
      (this.sun.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }

    // 行星纹理（并行加载）
    const texturePromises = this.planets.map(async (p) => {
      const tex = await loadPlanetTexture(p.data, () => this.createPlanetTexture(p.data));
      (p.mesh.material as THREE.MeshStandardMaterial).map = tex;
      (p.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    });
    await Promise.all(texturePromises);

    // 土星环纹理
    const saturn = this.planets.find((p) => p.data.id === 'saturn');
    if (saturn) {
      const ring = saturn.mesh.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
      if (ring) {
        const ringTex = await loadSaturnRingTexture(() => {
          // 回退：用已有的程序化环纹理
          const m = ring.material as THREE.MeshBasicMaterial;
          return m.map ?? this.createSaturnRingTexture();
        });
        (ring.material as THREE.MeshBasicMaterial).map = ringTex;
        (ring.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
    }
  }

  /** 程序化土星环纹理（回退用） */
  private createSaturnRingTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 256; i++) {
      const alpha = 0.3 + Math.random() * 0.4;
      const shade = 180 + Math.random() * 60;
      ctx.fillStyle = `rgba(${shade},${shade - 20},${shade - 60},${alpha})`;
      ctx.fillRect(i, 0, 1, 32);
    }
    return new THREE.CanvasTexture(canvas);
  }

  // ============ 太阳 ============

  private createSun(): void {
    const sunRadius = SCALE_FACTORS.SUN_SCALE;

    // 太阳球体（自发光）
    const sunGeo = new THREE.SphereGeometry(sunRadius, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.group.add(this.sun);

    // 辉光 Sprite
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const ctx = glowCanvas.getContext('2d')!;
    const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,200,80,0.9)');
    grd.addColorStop(0.4, 'rgba(255,150,50,0.4)');
    grd.addColorStop(1, 'rgba(255,100,30,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.sunGlow = new THREE.Sprite(glowMat);
    this.sunGlow.scale.set(sunRadius * 6, sunRadius * 6, 1);
    this.group.add(this.sunGlow);

    // 点光源（模拟太阳辐射）
    // Three.js r160 物理光照：intensity 单位为坎德拉，需要较大值才能照亮远处行星
    // distance=0 表示无截断衰减，decay=2 为物理正确的平方反比衰减
    const pointLight = new THREE.PointLight(0xffeecc, 800, 0, 2);
    this.group.add(pointLight);

    // 环境光（保证暗面可见，提到 1.2 让行星暗面也可辨识）
    const ambient = new THREE.AmbientLight(0x6080a0, 1.2);
    this.group.add(ambient);
  }

  // ============ 行星 ============

  private createPlanets(): void {
    for (const data of PLANET_DATA) {
      const r = scaledRadius(data.radius);
      const geo = new THREE.SphereGeometry(r, 48, 48);
      const tex = this.createPlanetTexture(data);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: data.type === 'gas' ? 0.9 : 0.8,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // 轴倾角
      mesh.rotation.z = (data.tilt * Math.PI) / 180;

      // 初始位置（轨道角度随机分布）
      const orbitAngle = Math.random() * Math.PI * 2;
      const a = scaledDistance(data.distance);
      const b = a * Math.sqrt(1 - data.eccentricity ** 2);
      const c = a * data.eccentricity;
      mesh.position.x = a * Math.cos(orbitAngle) - c;
      mesh.position.z = b * Math.sin(orbitAngle);

      this.group.add(mesh);

      // 土星环
      if (data.rings) {
        this.createRings(mesh, r);
      }

      // 公转速度：1/period 年，乘以 0.2 便于观察
      const orbitSpeed = (1 / data.period) * 0.2;
      // 自转速度：使用真实 dayLength，地球=1天为基准
      // dayLength 为天，转换为 rad/s：2π / (dayLength * 86400)
      // 视觉加速：乘以 1000 倍便于观察，负值表示逆向
      const rotationSpeed = (Math.sign(data.dayLength) * 2 * Math.PI) / (Math.abs(data.dayLength) * 86400) * 1000;

      this.planets.push({ data, mesh, orbitAngle, orbitSpeed, rotationSpeed });
    }
  }

  /** 程序化生成行星纹理（Canvas 噪声，无需外部素材） */
  private createPlanetTexture(planet: PlanetData): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const baseColor = new THREE.Color(planet.color);
    const r = Math.floor(baseColor.r * 255);
    const g = Math.floor(baseColor.g * 255);
    const b = Math.floor(baseColor.b * 255);

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 512, 256);

    if (planet.type === 'gas' && planet.bands) {
      // 气态行星：水平条纹
      for (let i = 0; i < 256; i += 4) {
        const variance = (Math.random() - 0.5) * 40;
        const cr = Math.max(0, Math.min(255, r + variance));
        const cg = Math.max(0, Math.min(255, g + variance));
        const cb = Math.max(0, Math.min(255, b + variance));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
        ctx.fillRect(0, i, 512, 4);
      }
      // 木星大红斑
      if (planet.id === 'jupiter') {
        const grd = ctx.createRadialGradient(350, 150, 5, 350, 150, 40);
        grd.addColorStop(0, 'rgba(180,60,40,0.9)');
        grd.addColorStop(1, 'rgba(180,60,40,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(310, 110, 80, 80);
      }
    } else if (planet.type === 'ice') {
      // 冰巨星：淡色渐变
      const grd = ctx.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, `rgba(${r},${g},${b},0.3)`);
      grd.addColorStop(0.5, `rgba(${r + 20},${g + 20},${b + 20},0.8)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0.3)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 512, 256);
    } else {
      // 岩石行星：噪声点（陨石坑感）
      for (let i = 0; i < 800; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 256;
        const radius = Math.random() * 3 + 1;
        const variance = (Math.random() - 0.5) * 60;
        const cr = Math.max(0, Math.min(255, r + variance));
        const cg = Math.max(0, Math.min(255, g + variance));
        const cb = Math.max(0, Math.min(255, b + variance));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.5)`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // 地球特殊处理：蓝色海洋 + 绿色陆地 + 云层
      if (planet.id === 'earth') {
        ctx.fillStyle = 'rgba(40,100,180,0.6)';
        ctx.fillRect(0, 0, 512, 256);
        for (let i = 0; i < 30; i++) {
          const x = Math.random() * 512;
          const y = Math.random() * 256;
          const w = Math.random() * 80 + 30;
          const h = Math.random() * 50 + 20;
          ctx.fillStyle = `rgba(${60 + Math.random() * 40},${100 + Math.random() * 60},${40 + Math.random() * 30},0.7)`;
          ctx.beginPath();
          ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.3})`;
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 256, Math.random() * 20 + 10, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  /** 土星环 */
  private createRings(planetMesh: THREE.Mesh, planetRadius: number): void {
    const innerR = planetRadius * 1.3;
    const outerR = planetRadius * 2.2;
    const ringGeo = new THREE.RingGeometry(innerR, outerR, 96);

    // 程序化环纹理
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 256; i++) {
      const alpha = 0.3 + Math.random() * 0.4;
      const shade = 180 + Math.random() * 60;
      ctx.fillStyle = `rgba(${shade},${shade - 20},${shade - 60},${alpha})`;
      ctx.fillRect(i, 0, 1, 32);
    }
    const ringTex = new THREE.CanvasTexture(canvas);
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 - 0.3;
    planetMesh.add(ring);
  }

  // ============ 轨道线 ============

  private createOrbits(): void {
    for (const data of PLANET_DATA) {
      const a = scaledDistance(data.distance);
      const b = a * Math.sqrt(1 - data.eccentricity ** 2);
      const curve = new THREE.EllipseCurve(
        0, 0,
        a, b,
        0, Math.PI * 2,
        false, 0,
      );
      const points = curve.getPoints(128);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x445588,
        transparent: true,
        opacity: 0.4,
      });
      const orbit = new THREE.Line(geometry, material);
      orbit.rotation.x = Math.PI / 2;
      this.group.add(orbit);
      this.orbits.push(orbit);
    }
  }

  // ============ 后处理 ============

  private setupPostprocessing(): void {
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,  // strength（降低避免行星过曝）
      0.4,  // radius
      0.3,  // threshold（降低让中等亮度区域也有轻微辉光）
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());
  }

  // ============ 相机 ============

  private setupCamera(): void {
    this.camera.position.set(0, 80, 120);
    this.camera.lookAt(0, 0, 0);
  }

  // ============ 更新与渲染 ============

  /** 设置速度倍率 */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  /** 注入 OrbitControls（由 SolarSystemCanvas 创建并传入） */
  setControls(controls: OrbitControls): void {
    this.controls = controls;
  }

  /** 飞向指定行星 */
  flyToPlanet(planetId: string): void {
    const planet = this.planets.find((p) => p.data.id === planetId);
    if (!planet) return;
    const target = planet.mesh.position;
    const r = scaledRadius(planet.data.radius);
    this.camera.position.set(
      target.x + r * 3,
      target.y + r * 2,
      target.z + r * 3,
    );
    this.camera.lookAt(target);
    // 同步 OrbitControls 的 target，让后续拖动围绕该行星
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  /** 主循环更新 */
  update(): void {
    const delta = this.clock.getDelta();
    this.time += delta;

    // 太阳自转
    if (this.sun) {
      this.sun.rotation.y += delta * 0.1;
    }
    // 太阳辉光脉动
    if (this.sunGlow) {
      const scale = SCALE_FACTORS.SUN_SCALE * 3 * (1 + Math.sin(this.time * 0.5) * 0.05);
      this.sunGlow.scale.set(scale, scale, 1);
    }

    // 行星公转 + 自转
    for (const p of this.planets) {
      p.orbitAngle += p.orbitSpeed * delta * this.speedMultiplier;
      const a = scaledDistance(p.data.distance);
      const b = a * Math.sqrt(1 - p.data.eccentricity ** 2);
      const c = a * p.data.eccentricity;
      p.mesh.position.x = a * Math.cos(p.orbitAngle) - c;
      p.mesh.position.z = b * Math.sin(p.orbitAngle);

      // 真实自转速度（含逆向）
      p.mesh.rotation.y += p.rotationSpeed * delta * this.speedMultiplier;
    }

    // OrbitControls 阻尼更新（enableDamping 时每帧必须调用）
    if (this.controls) {
      this.controls.update();
    }
  }

  /** 渲染（使用 composer） */
  render(): void {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** 启动动画循环（太阳系场景使用 setInterval 节流，非每帧渲染）
   *
   *  性能优化（issue #19）：
   *    update + render 在复杂场景下每帧 ~80-120ms，会触发 rAF handler 警告。
   *    太阳系教学场景无需 60FPS，节流到 ~30FPS（33ms）即可保持视觉流畅，
   *    CPU/GPU 负载降低约 50%。
   */
  start(): void {
    if (this.animationId !== null) return;
    // 使用 setInterval 替代 requestAnimationFrame，
    // 太阳系场景不参与 Cesium 渲染同步，独立 30FPS 足够
    const THROTTLE_MS = 33;
    const throttle = createTickThrottle(THROTTLE_MS);
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      if (throttle()) {
        this.update();
        this.render();
      }
    };
    loop();
  }

  /** 停止动画循环 */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /** 窗口大小变化 */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
  }

  /** 销毁：释放 WebGL 资源 */
  dispose(): void {
    this.stop();
    this.controls?.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
    this.scene.remove(this.group);
    this.composer?.dispose();
  }
}
