'use client';

import { useEffect, useRef } from 'react';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  opacity: number;
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const ANGLE = 0.15; // slight rightward lean
const COUNT = 200;

function spawnDrop(w: number, h: number, initial = false): Drop {
  const tier = Math.random();
  return {
    x: Math.random() * (w + 160) - 80,
    y: initial ? Math.random() * h : -(Math.random() * 80 + 20),
    // far: 4-6px  mid: 6-9px  near: 9-13px
    len:
      tier < 0.45
        ? ((Math.random() * 3) | 0) + 4
        : tier < 0.78
          ? ((Math.random() * 4) | 0) + 6
          : ((Math.random() * 5) | 0) + 9,
    speed:
      tier < 0.45
        ? Math.random() * 1.2 + 1.2
        : tier < 0.78
          ? Math.random() * 1.8 + 2.8
          : Math.random() * 2.5 + 5.0,
    opacity:
      tier < 0.45
        ? Math.random() * 0.1 + 0.04
        : tier < 0.78
          ? Math.random() * 0.12 + 0.13
          : Math.random() * 0.18 + 0.26,
  };
}

export function RainCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf: number;
    let drops: Drop[] = [];
    let splashes: Splash[] = [];
    const sx = Math.sin(ANGLE);
    const sy = Math.cos(ANGLE);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const d of drops) {
        ctx.beginPath();
        ctx.moveTo(d.x | 0, d.y | 0);
        ctx.lineTo((d.x + sx * d.len) | 0, (d.y + sy * d.len) | 0);
        ctx.strokeStyle = `rgba(120, 210, 188, ${d.opacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        d.x += sx * d.speed;
        d.y += sy * d.speed;

        if (d.y > canvas.height + 20) {
          const n = ((Math.random() * 3) | 0) + 1;
          for (let i = 0; i < n; i++) {
            const a = (Math.random() * 0.75 + 0.125) * Math.PI;
            const sp = Math.random() * 1.2 + 0.4;
            splashes.push({
              x: d.x,
              y: canvas.height - 3,
              vx: Math.cos(a) * sp * (Math.random() > 0.5 ? 1 : -1),
              vy: -Math.sin(a) * sp,
              life: ((Math.random() * 16) | 0) + 10,
            });
          }
          Object.assign(d, spawnDrop(canvas.width, canvas.height));
        }
      }

      const next: Splash[] = [];
      for (const s of splashes) {
        const alpha = (s.life / 26) * 0.3;
        ctx.fillStyle = `rgba(120, 210, 188, ${alpha})`;
        ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08;
        s.life--;
        if (s.life > 0) next.push(s);
      }
      splashes = next;

      raf = requestAnimationFrame(tick);
    };

    resize();
    drops = Array.from({ length: COUNT }, () =>
      spawnDrop(canvas.width, canvas.height, true),
    );
    tick();

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: -995 }}
    />
  );
}
