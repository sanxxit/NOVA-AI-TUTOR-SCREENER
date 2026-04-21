'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

export type WaveState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'complete';

interface Props {
  analyserNode: AnalyserNode | null;
  state: WaveState;
  className?: string;
}

interface SpringPoint {
  pos: number;
  vel: number;
}

const NUM_SPRINGS = 96;

function springConstants(state: WaveState): { tension: number; damping: number } {
  switch (state) {
    case 'speaking':  return { tension: 0.38, damping: 0.70 };
    case 'listening': return { tension: 0.24, damping: 0.80 };
    case 'thinking':  return { tension: 0.10, damping: 0.90 };
    default:          return { tension: 0.05, damping: 0.95 };
  }
}

function amplitudeScale(state: WaveState): number {
  switch (state) {
    case 'speaking':  return 0.46;
    case 'listening': return 0.38;
    default:          return 0.22;
  }
}

export default function LiveCanvasWaveform({ analyserNode, state, className = '' }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const phaseRef   = useRef(0);
  const springsRef = useRef<SpringPoint[]>(
    Array.from({ length: NUM_SPRINGS }, () => ({ pos: 0, vel: 0 })),
  );

  // Theme — stored in a ref so theme changes don't restart the RAF loop
  const { resolvedTheme } = useTheme();
  const isDarkRef = useRef(resolvedTheme !== 'light');
  useEffect(() => {
    isDarkRef.current = resolvedTheme !== 'light';
  }, [resolvedTheme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect  = canvas.getBoundingClientRect();
      canvas.width  = Math.round(rect.width  * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const springs                 = springsRef.current;
    const { tension, damping }    = springConstants(state);
    const ampScale                = amplitudeScale(state);

    const draw = () => {
      const W  = canvas.width;
      const H  = canvas.height;
      const cy = H / 2;
      const dark = isDarkRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.shadowBlur = 0;

      // ── Spring targets ────────────────────────────────────────────────────

      const targets = new Float32Array(NUM_SPRINGS);

      if (analyserNode) {
        const bufSize   = analyserNode.frequencyBinCount;
        const data      = new Uint8Array(bufSize);
        analyserNode.getByteTimeDomainData(data);
        for (let i = 0; i < NUM_SPRINGS; i++) {
          const srcIdx = Math.floor((i / (NUM_SPRINGS - 1)) * (bufSize - 1));
          targets[i]   = ((data[srcIdx] / 128.0) - 1) * H * ampScale;
        }
      } else {
        phaseRef.current += state === 'thinking' ? 0.048 : 0.014;
        const amp  = (state === 'thinking' ? 22 : 6) * dpr;
        const freq = state === 'thinking' ? 2.6 : 1.5;
        for (let i = 0; i < NUM_SPRINGS; i++) {
          targets[i] = Math.sin((i / (NUM_SPRINGS - 1)) * Math.PI * freq + phaseRef.current) * amp;
        }
      }

      // ── Damped spring physics ─────────────────────────────────────────────

      for (let i = 0; i < NUM_SPRINGS; i++) {
        const sp    = springs[i];
        const accel = (targets[i] - sp.pos) * tension;
        sp.vel      = sp.vel * damping + accel;
        sp.pos     += sp.vel;
      }

      // ── Smooth bezier path ────────────────────────────────────────────────

      const stepX = W / (NUM_SPRINGS - 1);
      ctx.beginPath();
      ctx.moveTo(0, cy + springs[0].pos);
      for (let i = 1; i < NUM_SPRINGS - 1; i++) {
        const x1  = (i - 1) * stepX;
        const x2  = i       * stepX;
        const midX = (x1 + x2) / 2;
        const midY = cy + (springs[i - 1].pos + springs[i].pos) / 2;
        ctx.quadraticCurveTo(x1, cy + springs[i - 1].pos, midX, midY);
      }
      ctx.lineTo(W, cy + springs[NUM_SPRINGS - 1].pos);

      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      // ── Theme-aware stroke styles ─────────────────────────────────────────

      if (state === 'speaking') {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        if (dark) {
          grad.addColorStop(0,    'rgba(109,40,217,0.95)');
          grad.addColorStop(0.33, 'rgba(168,85,247,1)');
          grad.addColorStop(0.66, 'rgba(217,70,239,1)');
          grad.addColorStop(1,    'rgba(109,40,217,0.95)');
          ctx.shadowColor = 'rgba(168,85,247,0.70)';
          ctx.shadowBlur  = 28 * dpr;
        } else {
          // Light mode — deep indigo gradient, no bloom (stays crisp)
          grad.addColorStop(0,    'rgba(67,56,202,0.90)');
          grad.addColorStop(0.33, 'rgba(79,70,229,1)');
          grad.addColorStop(0.66, 'rgba(124,58,237,1)');
          grad.addColorStop(1,    'rgba(67,56,202,0.90)');
        }
        ctx.strokeStyle = grad;
        ctx.lineWidth   = 2.5 * dpr;
      } else if (state === 'listening') {
        if (dark) {
          ctx.strokeStyle = 'rgba(255,255,255,0.82)';
          ctx.shadowColor = 'rgba(255,255,255,0.38)';
          ctx.shadowBlur  = 10 * dpr;
        } else {
          // Light mode — sharp dark slate line
          ctx.strokeStyle = 'rgba(15,23,42,0.80)';
        }
        ctx.lineWidth = 1.5 * dpr;
      } else if (state === 'thinking') {
        if (dark) {
          ctx.strokeStyle = 'rgba(139,92,246,0.55)';
          ctx.shadowColor = 'rgba(139,92,246,0.42)';
          ctx.shadowBlur  = 18 * dpr;
        } else {
          // Light mode — soft indigo
          ctx.strokeStyle = 'rgba(79,70,229,0.55)';
        }
        ctx.lineWidth = 1.5 * dpr;
      } else {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.12)';
        ctx.lineWidth   = 1 * dpr;
      }

      ctx.stroke();
      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyserNode, state]);

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full ${className}`}
    />
  );
}
