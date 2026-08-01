/**
 * 全页背景 —— 轻量 Canvas 星空（约 220 颗星，2 层 twinkle + 偶发流星）
 *
 * 设计约束：
 *   · Cesium/Solar canvas 层级在 z-0 之上，本组件绝对定位 z-[-1] / 背景，不拦截交互
 *   · 使用 requestAnimationFrame，但 15 FPS 上限（sleep 40ms），避免和 3D 主画面抢帧
 *   · prefers-reduced-motion：停动画，仅一次 paint 静态星点
 */
import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; r: number; a: number; s: number; hue: number };
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number };

const STAR_COUNT = 220;
const MAX_FPS_MS = 1000 / 15;

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let lastPaint = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rand = seededRand(20250417);

    const stars: Star[] = [];
    const meteors: Meteor[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 按面积比例放缩星数，但保持可感范围
      const area = Math.max(320 * 320, Math.min(width * height, 2560 * 1440));
      const target = Math.round(STAR_COUNT * (area / (1280 * 800)));
      stars.length = 0;
      for (let i = 0; i < target; i++) {
        stars.push({
          x: rand() * width,
          y: rand() * height,
          r: rand() * 1.2 + 0.2,
          a: rand() * 0.9 + 0.1,
          s: rand() * 0.6 + 0.15,
          hue: rand() < 0.12 ? 210 : rand() < 0.05 ? 40 : 220,
        });
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const spawnMeteor = () => {
      const fromLeft = rand() < 0.5;
      const x = fromLeft ? -30 : width + 30;
      const y = rand() * height * 0.55;
      const speed = (rand() * 6 + 7) * (fromLeft ? 1 : -1);
      meteors.push({ x, y, vx: speed, vy: Math.abs(speed) * 0.35 + 0.5, life: 0, max: rand() * 40 + 60 });
    };

    let meteorTimer = 0;
    let tAccum = 0;

    const paint = () => {
      ctx.clearRect(0, 0, width, height);

      // 星点
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        const alpha = prefersReduced
          ? st.a
          : Math.max(0.08, Math.min(1, st.a + Math.sin((tAccum + i) * st.s) * 0.35));
        ctx.beginPath();
        ctx.fillStyle = `hsla(${st.hue}, 70%, ${88 + (st.r > 0.9 ? 6 : 0)}%, ${alpha})`;
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 流星
      if (!prefersReduced) {
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i];
          m.x += m.vx;
          m.y += m.vy;
          m.life += 1;
          const prog = m.life / m.max;
          const a = prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85;
          if (m.life >= m.max || m.y > height + 50 || m.x < -100 || m.x > width + 100) {
            meteors.splice(i, 1);
            continue;
          }
          const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 10, m.y - m.vy * 10);
          grad.addColorStop(0, `hsla(210, 100%, 92%, ${a})`);
          grad.addColorStop(1, 'hsla(210, 100%, 80%, 0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * 10, m.y - m.vy * 10);
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = now - lastPaint;
      if (delta < MAX_FPS_MS) return;
      lastPaint = now;
      if (!prefersReduced) {
        tAccum += delta / 1000;
        meteorTimer += delta;
        if (meteorTimer > 6500 + rand() * 4500) {
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
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 select-none"
      style={{ mixBlendMode: 'screen', opacity: 0.92 }}
    />
  );
}
