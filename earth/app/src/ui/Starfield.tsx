/**
 * Q5 升级：全页银河背景 —— 分层暖色深空 + 多层星云 + 3 档星点 + 偶发彩色流星
 *
 * 设计约束：
 *   · Cesium/Solar canvas 层级在 z-0 之上，本组件绝对定位 z-[-1] / 背景，不拦截交互
 *   · 使用 requestAnimationFrame，15 FPS 上限，避免和 3D 主画面抢帧
 *   · prefers-reduced-motion / _starfieldAnimated=false 时只画静态帧（无 twinkle/流星）
 */
import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; r: number; a: number; s: number; hue: number; sat: number; tier: 0 | 1 | 2 };
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number };
type Nebula = { cx: number; cy: number; rx: number; ry: number; rot: number; hue: number; alpha: number };

const STAR_TIER_COUNTS: [number, number, number] = [340, 80, 14]; // 背景细星 / 中层 / 亮星
const MAX_FPS_MS = 1000 / 15;

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** 在一个旋转椭圆坐标内采样（用于银河条带内的星点权重偏移） */
function sampleInGalaxyBand(rand: () => number, w: number, h: number): { x: number; y: number } {
  // 条带中心：从 (0.08w, 0.86h) 到 (0.94w, 0.20h) —— 左下 → 右上 的对角银河
  const t = Math.pow(rand(), 0.6); // 偏向中间
  const cx = (0.08 + (0.94 - 0.08) * t) * w;
  const cy = (0.86 + (0.20 - 0.86) * t) * h;
  // 垂直条带方向的短轴散布（条带宽约 38% h 量级）
  const spread = rand() - 0.5;
  const dx = spread * (0.22 * h);
  const dy = -spread * (0.12 * w); // 与条带主轴垂直（近似）
  return { x: cx + dx, y: cy + dy };
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const animatedFromWindow = () =>
      (window as unknown as { _starfieldAnimated?: unknown })._starfieldAnimated !== false;
    let anim = prefersReduced ? false : animatedFromWindow();

    let raf = 0;
    let lastPaint = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rand = seededRand(20250418);

    const stars: Star[] = [];
    const meteors: Meteor[] = [];
    const nebulae: Nebula[] = [];

    const buildStarsAndNebulae = () => {
      stars.length = 0;
      nebulae.length = 0;

      // 多层星云（5 个柔焦椭圆）：不跟着 resize 随机化，只在 init/resize 重算
      const NEBULA_HUES = [
        { h: 12, s: 85, a: 0.10 }, // 暖琥珀
        { h: 280, s: 55, a: 0.08 }, // 尘紫
        { h: 335, s: 75, a: 0.07 }, // 桃粉
        { h: 210, s: 80, a: 0.05 }, // 冷蓝
        { h: 40, s: 95, a: 0.06 },  // 金橙
      ];
      for (let i = 0; i < NEBULA_HUES.length; i++) {
        const hue = NEBULA_HUES[i];
        nebulae.push({
          cx: rand() * width,
          cy: rand() * height,
          rx: (rand() * 0.35 + 0.28) * Math.max(width, height),
          ry: (rand() * 0.12 + 0.08) * Math.max(width, height),
          rot: (rand() * 1.6 - 0.8), // ±0.8 rad 斜角
          hue: hue.h,
          alpha: hue.a,
        });
      }

      // T0 细星：均匀分布 + 40% 进入银河条带
      const t0Target = STAR_TIER_COUNTS[0];
      for (let i = 0; i < t0Target; i++) {
        const inBand = rand() < 0.4;
        const p = inBand ? sampleInGalaxyBand(rand, width, height) : { x: rand() * width, y: rand() * height };
        stars.push({
          x: p.x, y: p.y,
          r: rand() * 0.75 + 0.15,
          a: rand() * 0.6 + 0.25,
          s: rand() * 0.5 + 0.08,
          hue: rand() < 0.7 ? 220 : rand() < 0.5 ? 40 : 330,
          sat: rand() < 0.7 ? 30 : 60,
          tier: 0,
        });
      }
      // T1 中星：50% 在银河条带
      const t1Target = STAR_TIER_COUNTS[1];
      for (let i = 0; i < t1Target; i++) {
        const inBand = rand() < 0.5;
        const p = inBand ? sampleInGalaxyBand(rand, width, height) : { x: rand() * width, y: rand() * height };
        stars.push({
          x: p.x, y: p.y,
          r: rand() * 0.7 + 0.8,
          a: rand() * 0.5 + 0.45,
          s: rand() * 0.7 + 0.2,
          hue: rand() < 0.35 ? 210 : rand() < 0.5 ? 40 : rand() < 0.5 ? 290 : 340,
          sat: 70,
          tier: 1,
        });
      }
      // T2 亮星（带十字光晕的"钻石"）：多数在银河带，色彩丰富
      const t2Target = STAR_TIER_COUNTS[2];
      for (let i = 0; i < t2Target; i++) {
        const inBand = rand() < 0.85;
        const p = inBand ? sampleInGalaxyBand(rand, width, height) : { x: rand() * width, y: rand() * height };
        stars.push({
          x: p.x, y: p.y,
          r: rand() * 0.8 + 1.4,
          a: rand() * 0.25 + 0.75,
          s: rand() * 0.9 + 0.3,
          hue: [10, 35, 190, 210, 285, 325][Math.floor(rand() * 6)],
          sat: 85,
          tier: 2,
        });
      }
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStarsAndNebulae();
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnMeteor = () => {
      const fromLeft = rand() < 0.5;
      const x = fromLeft ? -40 : width + 40;
      const y = rand() * height * 0.6 + height * 0.05;
      const speed = (rand() * 7 + 8) * (fromLeft ? 1 : -1);
      const hue = [200, 45, 20, 330][Math.floor(rand() * 4)];
      meteors.push({ x, y, vx: speed, vy: Math.abs(speed) * 0.32 + 0.6, life: 0, max: Math.floor(rand() * 50 + 70), hue });
    };

    let meteorTimer = 0;
    let tAccum = 0;

    /** 星云底层（柔焦）—— 只在 resize 后画一次到离屏，再每帧贴回来省性能 */
    const offscreen = document.createElement('canvas');
    const octx = offscreen.getContext('2d')!;
    const paintNebulaeOnce = () => {
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, width, height);
      octx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < nebulae.length; i++) {
        const n = nebulae[i];
        octx.save();
        octx.translate(n.cx, n.cy);
        octx.rotate(n.rot);
        const g = octx.createRadialGradient(0, 0, 0, 0, 0, Math.max(n.rx, n.ry));
        g.addColorStop(0, `hsla(${n.hue}, 90%, 78%, ${n.alpha})`);
        g.addColorStop(0.45, `hsla(${n.hue}, 85%, 65%, ${n.alpha * 0.45})`);
        g.addColorStop(1, `hsla(${n.hue}, 85%, 55%, 0)`);
        octx.fillStyle = g;
        octx.beginPath();
        octx.ellipse(0, 0, n.rx, n.ry, 0, 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
      octx.globalCompositeOperation = 'source-over';
    };
    paintNebulaeOnce();
    window.addEventListener('resize', paintNebulaeOnce);

    const paint = () => {
      ctx.clearRect(0, 0, width, height);

      // 1. 星云（从离屏贴回来，极快）
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(offscreen, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      // 2. 星点（3 档，T2 带十字光晕）
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        const alpha = anim
          ? Math.max(0.1, Math.min(1, st.a + Math.sin((tAccum + i * 0.9) * st.s) * (st.tier === 2 ? 0.45 : 0.32)))
          : st.a;
        if (st.tier === 2) {
          // 亮星：圆盘 + 柔光 + 十字 diffraction spike
          const halo = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r * 6);
          halo.addColorStop(0, `hsla(${st.hue}, ${st.sat}%, 92%, ${alpha * 0.55})`);
          halo.addColorStop(1, `hsla(${st.hue}, ${st.sat}%, 70%, 0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r * 6, 0, Math.PI * 2);
          ctx.fill();
          // 十字：长轴
          ctx.strokeStyle = `hsla(${st.hue}, ${st.sat}%, 96%, ${alpha * 0.6})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const len = st.r * 10;
          ctx.moveTo(st.x - len, st.y); ctx.lineTo(st.x + len, st.y);
          ctx.moveTo(st.x, st.y - len); ctx.lineTo(st.x, st.y + len);
          ctx.stroke();
          // 核心点
          ctx.fillStyle = `hsla(${st.hue}, ${st.sat}%, 98%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // T0/T1：普通圆盘（亮一点的带外晕）
          if (st.tier === 1) {
            const halo = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r * 3.5);
            halo.addColorStop(0, `hsla(${st.hue}, ${st.sat}%, 85%, ${alpha * 0.35})`);
            halo.addColorStop(1, `hsla(${st.hue}, ${st.sat}%, 60%, 0)`);
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(st.x, st.y, st.r * 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = `hsla(${st.hue}, ${st.sat}%, ${st.tier === 1 ? 92 : 86}%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3. 流星（仅动画开启时）—— 彩色拖尾
      if (anim) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          m.x += m.vx;
          m.y += m.vy;
          m.life += 1;
          const prog = m.life / m.max;
          const a = prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85;
          if (m.life >= m.max || m.y > height + 50 || m.x < -120 || m.x > width + 120) {
            meteors.splice(i, 1);
            continue;
          }
          const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 12, m.y - m.vy * 12);
          grad.addColorStop(0, `hsla(${m.hue}, 100%, 95%, ${a})`);
          grad.addColorStop(0.4, `hsla(${(m.hue + 20) % 360}, 100%, 85%, ${a * 0.6})`);
          grad.addColorStop(1, `hsla(${(m.hue + 40) % 360}, 100%, 80%, 0)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * 12, m.y - m.vy * 12);
          ctx.stroke();
          // 流星头
          ctx.fillStyle = `hsla(${m.hue}, 100%, 98%, ${a})`;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = now - lastPaint;
      if (delta < MAX_FPS_MS) return;
      lastPaint = now;
      anim = prefersReduced ? false : animatedFromWindow();
      if (anim) {
        tAccum += delta / 1000;
        meteorTimer += delta;
        if (meteorTimer > 5500 + rand() * 5000) {
          meteorTimer = 0;
          if (meteors.length < 2) spawnMeteor();
        }
      }
      paint();
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('resize', paintNebulaeOnce);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[-1] select-none"
      style={{ opacity: 0.97 }}
    />
  );
}
