/**
 * Solar System Module - 太阳系仿真模块
 * 提供：太阳本体辉光、8大行星程序化纹理、椭圆轨道线、真实天文数据
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 真实天文数据（距离AU、半径km、公转周期年、自转周期天、偏心率、倾角°）
const PLANET_DATA = [
  { id: 'mercury', name: '水星', radius: 2440, distance: 0.39, period: 0.24, dayLength: 58.6, eccentricity: 0.206, tilt: 0.03, color: 0x9c8b7a, type: 'rocky' },
  { id: 'venus',   name: '金星', radius: 6052, distance: 0.72, period: 0.62, dayLength: -243,  eccentricity: 0.007, tilt: 177,  color: 0xe6c87a, type: 'rocky' },
  { id: 'earth',   name: '地球', radius: 6371, distance: 1.00, period: 1.00, dayLength: 1.00,  eccentricity: 0.017, tilt: 23.5, color: 0x2a6fb8, type: 'rocky' },
  { id: 'mars',    name: '火星', radius: 3390, distance: 1.52, period: 1.88, dayLength: 1.03,  eccentricity: 0.093, tilt: 25.2, color: 0xc1440e, type: 'rocky' },
  { id: 'jupiter', name: '木星', radius: 69911, distance: 5.20, period: 11.86, dayLength: 0.41, eccentricity: 0.048, tilt: 3.1,  color: 0xd4a574, type: 'gas', bands: true },
  { id: 'saturn',  name: '土星', radius: 58232, distance: 9.58, period: 29.46, dayLength: 0.45, eccentricity: 0.054, tilt: 26.7, color: 0xf4d59e, type: 'gas', rings: true },
  { id: 'uranus',  name: '天王星', radius: 25362, distance: 19.22, period: 84.01, dayLength: -0.72, eccentricity: 0.047, tilt: 97.8, color: 0x9fd3d3, type: 'ice' },
  { id: 'neptune', name: '海王星', radius: 24622, distance: 30.05, period: 164.8, dayLength: 0.67, eccentricity: 0.009, tilt: 28.3, color: 0x4a67c6, type: 'ice' }
];

// 缩放参数：距离对数压缩，行星半径开方压缩（保证可见性）
const SUN_SCALE = 4;
const DISTANCE_SCALE = 6;      // AU * 此值 = 场景单位
const RADIUS_SCALE = 0.0008;   // km * 此值 = 场景单位（开方后视觉更平衡）

class SolarSystem {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.planets = [];
    this.orbits = [];
    this.sun = null;
    this.sunGlow = null;
    this.composer = null;
    this.bloomPass = null;
    this.time = 0;
    this.enabled = false;
    this.speedMultiplier = 1;

    scene.add(this.group);
  }

  // 程序化生成行星纹理（Canvas 噪声）
  createPlanetTexture(planet) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const baseColor = new THREE.Color(planet.color);
    const r = Math.floor(baseColor.r * 255);
    const g = Math.floor(baseColor.g * 255);
    const b = Math.floor(baseColor.b * 255);

    // 基础色填充
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
      grd.addColorStop(0.5, `rgba(${r+20},${g+20},${b+20},0.8)`);
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
      // 地球特殊处理：蓝色海洋 + 绿色陆地
      if (planet.id === 'earth') {
        ctx.fillStyle = 'rgba(40,100,180,0.6)';
        ctx.fillRect(0, 0, 512, 256);
        // 随机大陆
        for (let i = 0; i < 30; i++) {
          const x = Math.random() * 512;
          const y = Math.random() * 256;
          const w = Math.random() * 80 + 30;
          const h = Math.random() * 50 + 20;
          ctx.fillStyle = `rgba(${60 + Math.random()*40},${100 + Math.random()*60},${40 + Math.random()*30},0.7)`;
          ctx.beginPath();
          ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        // 云层
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

  // 创建太阳本体（自发光）
  createSun() {
    const sunRadius = SUN_SCALE * 0.5;

    // 太阳球体（自发光材质）
    const sunGeo = new THREE.SphereGeometry(sunRadius, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33
    });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.sun.userData = { isSun: true, name: '太阳' };
    this.group.add(this.sun);

    // 太阳辉光（多层 Sprite）
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const grd = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,200,80,0.9)');
    grd.addColorStop(0.3, 'rgba(255,150,50,0.5)');
    grd.addColorStop(0.6, 'rgba(255,100,30,0.2)');
    grd.addColorStop(1, 'rgba(255,100,30,0)');
    gctx.fillStyle = grd;
    gctx.fillRect(0, 0, 256, 256);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.sunGlow = new THREE.Sprite(glowMat);
    this.sunGlow.scale.set(sunRadius * 6, sunRadius * 6, 1);
    this.group.add(this.sunGlow);

    // 太阳光源（PointLight 替代 DirectionalLight，模拟太阳辐射）
    this.sunLight = new THREE.PointLight(0xffeecc, 2, 200, 1.5);
    this.sunLight.position.set(0, 0, 0);
    this.group.add(this.sunLight);

    // 环境光（保证暗面可见）
    this.ambient = new THREE.AmbientLight(0x404060, 0.4);
    this.group.add(this.ambient);

    // 太阳标签
    this.createLabel('太阳', this.sun, sunRadius + 1);
  }

  // 创建行星
  createPlanet(planet) {
    // 半径缩放：开方压缩，保证小行星可见
    const scaledRadius = Math.max(0.3, Math.sqrt(planet.radius * RADIUS_SCALE));
    // 距离：AU * 缩放 + 太阳半径偏移
    const scaledDistance = planet.distance * DISTANCE_SCALE + SUN_SCALE + 2;

    const geo = new THREE.SphereGeometry(scaledRadius, 48, 48);
    const texture = this.createPlanetTexture(planet);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: planet.type === 'rocky' ? 0.9 : 0.6,
      metalness: 0.0
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = {
      name: planet.name,
      distance: scaledDistance,
      period: planet.period,
      eccentricity: planet.eccentricity,
      tilt: planet.tilt,
      angle: Math.random() * Math.PI * 2
    };

    // 初始位置（椭圆轨道）
    this.updatePlanetPosition(mesh, mesh.userData.angle);

    // 地轴倾角
    mesh.rotation.z = planet.tilt * Math.PI / 180;

    // 土星环
    if (planet.rings) {
      const ringGeo = new THREE.RingGeometry(scaledRadius * 1.3, scaledRadius * 2.2, 96);
      // 程序化环纹理
      const ringCanvas = document.createElement('canvas');
      ringCanvas.width = 256;
      ringCanvas.height = 32;
      const rctx = ringCanvas.getContext('2d');
      for (let i = 0; i < 256; i++) {
        const alpha = 0.3 + Math.random() * 0.4;
        const shade = 180 + Math.random() * 60;
        rctx.fillStyle = `rgba(${shade},${shade - 20},${shade - 60},${alpha})`;
        rctx.fillRect(i, 0, 1, 32);
      }
      const ringTex = new THREE.CanvasTexture(ringCanvas);
      const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.3;
      mesh.add(ring);
    }

    this.group.add(mesh);
    this.planets.push(mesh);

    // 行星标签
    this.createLabel(planet.name, mesh, scaledRadius + 0.8);

    // 地球：添加月球
    if (planet.id === 'earth') {
      this.createMoon(mesh, scaledRadius);
    }

    return mesh;
  }

  // 创建月球（绕地球公转）
  createMoon(earthMesh, earthRadius) {
    const moonRadius = Math.max(0.15, earthRadius * 0.27);  // 月球约为地球半径0.27
    const moonDistance = earthRadius * 3.5;                  // 视觉距离

    const moonGeo = new THREE.SphereGeometry(moonRadius, 32, 32);
    // 月球纹理：灰白色 + 撞击坑
    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = 256;
    moonCanvas.height = 128;
    const mctx = moonCanvas.getContext('2d');
    mctx.fillStyle = '#b8b8b8';
    mctx.fillRect(0, 0, 256, 128);
    // 月海（深色区域）
    for (let i = 0; i < 8; i++) {
      mctx.fillStyle = `rgba(80,80,80,${0.4 + Math.random() * 0.3})`;
      mctx.beginPath();
      mctx.ellipse(Math.random() * 256, Math.random() * 128, Math.random() * 30 + 15, Math.random() * 20 + 10, 0, 0, Math.PI * 2);
      mctx.fill();
    }
    // 撞击坑
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 128;
      const r = Math.random() * 4 + 1;
      mctx.fillStyle = `rgba(${60 + Math.random() * 30},${60 + Math.random() * 30},${60 + Math.random() * 30},0.6)`;
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
    }
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    const moonMat = new THREE.MeshStandardMaterial({
      map: moonTex,
      roughness: 0.95,
      metalness: 0.0
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.userData = {
      isMoon: true,
      parent: earthMesh,
      distance: moonDistance,
      angle: Math.random() * Math.PI * 2,
      period: 27.3 / 365.25  // 27.3天周期（年为单位）
    };
    moon.position.set(moonDistance, 0, 0);
    earthMesh.add(moon);
    this.moon = moon;

    // 月球轨道线
    const moonOrbitGeo = new THREE.RingGeometry(moonDistance - 0.02, moonDistance + 0.02, 64);
    const moonOrbitMat = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const moonOrbit = new THREE.Mesh(moonOrbitGeo, moonOrbitMat);
    moonOrbit.rotation.x = Math.PI / 2;
    earthMesh.add(moonOrbit);

    return moon;
  }

  // 创建椭圆轨道线（网状效果）
  createOrbit(planet) {
    const scaledDistance = planet.distance * DISTANCE_SCALE + SUN_SCALE + 2;
    const a = scaledDistance;                          // 半长轴
    const b = a * Math.sqrt(1 - planet.eccentricity * planet.eccentricity); // 半短轴

    const curve = new THREE.EllipseCurve(
      0, 0,
      a, b,
      0, Math.PI * 2,
      false, 0
    );
    const points = curve.getPoints(128);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x445588,
      transparent: true,
      opacity: 0.4
    });
    const orbit = new THREE.Line(geometry, material);
    orbit.rotation.x = Math.PI / 2;  // 旋转到黄道面

    this.group.add(orbit);
    this.orbits.push(orbit);
    return orbit;
  }

  // 创建文字标签（Sprite）
  createLabel(text, parent, yOffset) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.roundRect(20, 20, 216, 24, 6);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4, 1, 1);
    sprite.position.copy(parent.position);
    sprite.position.y += yOffset;
    sprite.userData = { isLabel: true, parent: parent, yOffset: yOffset };
    this.group.add(sprite);
    return sprite;
  }

  // 更新行星位置（开普勒椭圆轨道）
  updatePlanetPosition(mesh, angle) {
    const ud = mesh.userData;
    const a = ud.distance;
    const b = a * Math.sqrt(1 - ud.eccentricity * ud.eccentricity);
    // 焦点偏移（太阳在焦点上）
    const c = a * ud.eccentricity;

    mesh.position.x = a * Math.cos(angle) - c;
    mesh.position.z = b * Math.sin(angle);
  }

  // 初始化后期处理（Bloom 辉光）
  setupPostprocessing() {
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8,   // strength
      0.4,   // radius
      0.6    // threshold
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  // 初始化整个太阳系
  init() {
    if (this.enabled) return;
    this.createSun();

    PLANET_DATA.forEach(planet => {
      this.createOrbit(planet);
      this.createPlanet(planet);
    });

    this.setupPostprocessing();
    this.enabled = true;
  }

  // 更新动画
  update(delta) {
    if (!this.enabled) return;

    this.time += delta * this.speedMultiplier;

    // 太阳自转 + 辉光脉动
    if (this.sun) {
      this.sun.rotation.y += delta * 0.1;
      const pulse = 1 + Math.sin(this.time * 0.5) * 0.05;
      this.sunGlow.scale.set(SUN_SCALE * 3 * pulse, SUN_SCALE * 3 * pulse, 1);
    }

    // 行星公转 + 自转
    this.planets.forEach(mesh => {
      const ud = mesh.userData;
      // 公转角速度：基于真实周期反比
      const orbitSpeed = (1 / ud.period) * 0.2;
      ud.angle += orbitSpeed * delta * this.speedMultiplier;
      this.updatePlanetPosition(mesh, ud.angle);

      // 自转
      mesh.rotation.y += delta * 0.5 * this.speedMultiplier;

      // 更新标签位置
      this.group.children.forEach(child => {
        if (child.userData.isLabel && child.userData.parent === mesh) {
          child.position.copy(mesh.position);
          child.position.y += child.userData.yOffset;
        }
      });
    });

    // 月球公转
    if (this.moon) {
      const mud = this.moon.userData;
      const moonSpeed = (1 / mud.period) * 0.2 * 13;  // 加速以便观察
      mud.angle += moonSpeed * delta * this.speedMultiplier;
      this.moon.position.x = mud.distance * Math.cos(mud.angle);
      this.moon.position.z = mud.distance * Math.sin(mud.angle);
      this.moon.rotation.y += delta * 0.3 * this.speedMultiplier;
    }
  }

  // 渲染（用 composer 替代 renderer.render）
  render() {
    if (this.composer && this.enabled) {
      this.composer.render();
    }
  }

  // 窗口大小变化
  onResize(width, height) {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  }

  // 显示/隐藏
  setVisible(visible) {
    this.group.visible = visible;
  }

  // 销毁
  dispose() {
    this.planets.forEach(p => {
      p.geometry.dispose();
      if (p.material.map) p.material.map.dispose();
      p.material.dispose();
    });
    this.orbits.forEach(o => {
      o.geometry.dispose();
      o.material.dispose();
    });
    if (this.sun) {
      this.sun.geometry.dispose();
      this.sun.material.dispose();
    }
    if (this.composer) {
      this.composer.dispose();
    }
    this.scene.remove(this.group);
  }

  // 获取行星信息（供知识库联动）
  getPlanetInfo(planetId) {
    return PLANET_DATA.find(p => p.id === planetId);
  }

  // 飞行到指定行星
  flyToPlanet(planetId, camera, controls) {
    const planet = this.planets.find(p => p.userData.name === this.getPlanetInfo(planetId)?.name);
    if (!planet) return;

    const target = planet.position.clone();
    const offset = target.clone().normalize().multiplyScalar(5);
    const cameraTarget = target.clone().add(offset);

    // 简单线性插值（可改为 Tween）
    const startPos = camera.position.clone();
    const duration = 1500;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3);  // easeOutCubic

      camera.position.lerpVectors(startPos, cameraTarget, ease);
      if (controls) {
        controls.target.lerp(target, ease);
        controls.update();
      }

      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }
}

export { SolarSystem, PLANET_DATA };
