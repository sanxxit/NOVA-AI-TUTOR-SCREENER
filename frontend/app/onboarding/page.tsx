'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'init' | 'loading-model' | 'connecting' | 'mic-check' | 'audio-test' | 'ready' | 'error';

interface State {
  step: Step;
  progress: number;
  message: string;
  error?: string;
}

const SETUP_STEPS = [
  { label: 'Voice environment ready',    doneAt: 12  },
  { label: 'Speech recognition loaded',  doneAt: 80  },
  { label: 'Interview server connected', doneAt: 87  },
  { label: 'Microphone verified',        doneAt: 93  },
  { label: 'Audio quality confirmed',    doneAt: 100 },
];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({
    step: 'init',
    progress: 0,
    message: 'Preparing your voice environment…',
  });
  const [audioBars,    setAudioBars]    = useState<number[]>(new Array(32).fill(0));
  const [audioDetected, setAudioDetected] = useState(false);

  const cancelledRef    = useRef(false);
  const fileProgressRef = useRef(new Map<string, { loaded: number; total: number }>());
  const animFrameRef    = useRef<number>(0);
  const streamRef       = useRef<MediaStream | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const run = async () => {
      for (let i = 0; i <= 12; i++) {
        if (cancelledRef.current) return;
        setState((s) => ({ ...s, progress: i }));
        await sleep(35);
      }

      setState((s) => ({ ...s, step: 'loading-model', message: 'Loading speech recognition model…' }));

      try {
        const { pipeline, env } = await import('@xenova/transformers');
        env.allowLocalModels = false;

        await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
          progress_callback: (info: any) => {
            if (cancelledRef.current) return;
            if (info.status === 'progress' && info.total) {
              fileProgressRef.current.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
              const files   = Array.from(fileProgressRef.current.values());
              const loaded  = files.reduce((s, f) => s + f.loaded, 0);
              const total   = files.reduce((s, f) => s + f.total,  0);
              const pct     = total > 0 ? loaded / total : 0;
              const overall = Math.round(12 + pct * 68);
              setState((s) => ({
                ...s,
                progress: Math.max(s.progress, overall),
                message:  `Loading model… ${Math.round(pct * 100)}%`,
              }));
            }
            if (info.status === 'ready') {
              setState((s) => ({ ...s, progress: Math.max(s.progress, 78), message: 'Model ready.' }));
            }
          },
        });
      } catch {
        if (!cancelledRef.current) {
          setState({ step: 'error', progress: 0, message: '', error: 'Failed to load the speech model. Check your connection and refresh.' });
        }
        return;
      }

      if (cancelledRef.current) return;
      setState((s) => ({ ...s, progress: Math.max(s.progress, 80), message: 'Model ready.' }));
      await sleep(300);

      setState((s) => ({ ...s, step: 'connecting', progress: 83, message: 'Connecting to interview server…' }));

      try {
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';
        await new Promise<void>((resolve, reject) => {
          const ws      = new WebSocket(wsUrl);
          const timeout = setTimeout(() => { ws.close(); reject(new Error('Connection timeout')); }, 5000);
          ws.onopen    = () => ws.send(JSON.stringify({ type: 'ping' }));
          ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'connected' || data.type === 'pong') { clearTimeout(timeout); ws.close(); resolve(); }
          };
          ws.onerror = () => { clearTimeout(timeout); reject(new Error('Could not reach server')); };
        });
      } catch (err: any) {
        if (!cancelledRef.current) {
          setState({ step: 'error', progress: 83, message: '', error: `Server unreachable: ${err.message}. Make sure the backend is running on port 8000.` });
        }
        return;
      }

      if (cancelledRef.current) return;
      setState((s) => ({ ...s, step: 'mic-check', progress: 87, message: 'One last step — microphone access.' }));
    };

    run();
    return () => {
      cancelledRef.current = true;
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const requestMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const ctx      = new AudioContext();
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      setState((s) => ({ ...s, step: 'audio-test', progress: 93, message: 'Mic connected. Say a few words to test.' }));

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 32 }, (_, i) => {
          const idx = Math.floor((i / 32) * (data.length * 0.55));
          return data[idx] / 255;
        });
        setAudioBars(bars);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        if (avg > 6) setAudioDetected(true);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setState((s) => ({ ...s, error: 'Microphone access denied. Allow it in browser settings, then refresh.' }));
    }
  }, []);

  const confirmAudio = useCallback(async () => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    for (let i = 93; i <= 100; i++) {
      setState((s) => ({ ...s, progress: i, message: "All set — you're ready to go." }));
      await sleep(22);
    }
    setState((s) => ({ ...s, step: 'ready' }));
  }, []);

  const { step, progress, message, error } = state;
  const isReady   = step === 'ready';
  const isLoading = step === 'init' || step === 'loading-model' || step === 'connecting';

  return (
    <main className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-lg w-full space-y-8 animate-fade-in">

        {/* Header */}
        <div className="text-center space-y-3">
          {/* Minimal waveform decoration */}
          <div className="flex items-center justify-center gap-[3px] h-6 mb-1">
            {Array.from({ length: 24 }, (_, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  width: '2px',
                  backgroundColor: 'rgba(139,92,246,0.35)',
                  height: `${isLoading ? (Math.sin(i * 0.55) * 0.5 + 0.5) * 18 + 4 : (Math.sin(i * 0.55) * 0.5 + 0.5) * 10 + 3}px`,
                  animation: `waveformBreathe ${1.4 + (i % 4) * 0.25}s ease-in-out ${i * 0.04}s infinite`,
                }}
              />
            ))}
          </div>
          <h2 className="text-2xl font-bold text-white">
            {isReady ? "You're all set." : 'Getting your voice environment ready.'}
          </h2>
          {!isReady && (
            <p className="text-zinc-600 text-sm">
              {step === 'mic-check'
                ? 'Almost there — one quick permission needed.'
                : step === 'audio-test'
                ? "Take a breath. There's no rush."
                : 'This only downloads once — future sessions are instant.'}
            </p>
          )}
        </div>

        {/* Main surface */}
        <div
          className="rounded-xl border border-white/[0.08] p-8 space-y-7"
          style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(8px)' }}
        >
          {/* Progress bar */}
          {!isReady && !error && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">{message}</span>
                <span className="text-violet-400 font-semibold tabular-nums">{progress}%</span>
              </div>
              <div className="h-0.5 bg-white/[0.08] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7C3AED, #A855F7)' }}
                />
              </div>
            </div>
          )}

          {/* Step checklist */}
          <div className="space-y-3">
            {SETUP_STEPS.map((s) => {
              const done   = progress >= s.doneAt;
              const active = !done && progress >= s.doneAt - 20;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                      done   ? 'bg-violet-600'
                      : active ? 'bg-violet-500/20 ring-1 ring-violet-500/60'
                      :          'bg-white/[0.06]'
                    }`}
                  >
                    {done && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {active && !done && (
                      <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse-slow" />
                    )}
                  </div>
                  <span className={`text-sm transition-colors duration-300 ${
                    done ? 'text-white' : active ? 'text-zinc-400' : 'text-zinc-700'
                  }`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Error */}
          {error && (
            <div className="border border-red-500/30 bg-red-500/[0.08] rounded-lg p-4 space-y-2">
              <p className="text-red-400 text-sm leading-relaxed">{error}</p>
              <button onClick={() => window.location.reload()} className="text-red-500 text-xs underline">
                Refresh and try again
              </button>
            </div>
          )}

          {/* Mic permission */}
          {step === 'mic-check' && !error && (
            <div className="space-y-4">
              <div className="border border-violet-500/20 bg-violet-500/[0.07] rounded-lg p-4 text-center space-y-1">
                <p className="text-white text-sm font-medium">Your microphone is the only tool you need.</p>
                <p className="text-zinc-500 text-xs">We'll ask your browser for permission — it only takes a second.</p>
              </div>
              <button
                onClick={requestMic}
                className="w-full py-3.5 rounded-lg text-sm font-medium text-white transition-all duration-200 hover:shadow-[0_0_20px_rgba(139,92,246,0.35)] active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)' }}
              >
                Allow Microphone Access
              </button>
            </div>
          )}

          {/* Audio test */}
          {step === 'audio-test' && (
            <div className="space-y-5">
              <div className="space-y-4 text-center">
                <p className="text-zinc-500 text-sm">
                  Say{' '}
                  <span className="text-white font-medium">"Hello, I'm ready for my interview"</span>
                </p>
                <div className="flex items-center justify-center gap-[3px]" style={{ height: '56px' }}>
                  {audioBars.map((bar, i) => (
                    <div
                      key={i}
                      className="rounded-full"
                      style={{
                        width: '3px',
                        height: `${Math.max(3, bar * 52)}px`,
                        backgroundColor: bar > 0.04 ? '#8B5CF6' : 'rgba(255,255,255,0.08)',
                        transition: 'height 60ms ease-out, background-color 200ms',
                      }}
                    />
                  ))}
                </div>
                <p className={`text-xs font-medium transition-colors duration-300 ${audioDetected ? 'text-violet-400' : 'text-zinc-700'}`}>
                  {audioDetected ? '✓ Audio detected — sounds great!' : 'Waiting for your voice…'}
                </p>
              </div>
              <button
                onClick={confirmAudio}
                className="w-full py-3.5 rounded-lg text-sm font-medium text-white border border-white/[0.12] hover:bg-white/[0.05] transition-all duration-200"
              >
                Sounds good — Continue
              </button>
            </div>
          )}

          {/* Ready */}
          {isReady && (
            <div className="space-y-5 text-center">
              <div className="space-y-1">
                <p className="text-white text-base font-medium">Your voice environment is ready.</p>
                <p className="text-zinc-600 text-sm">There are no wrong answers. Just speak naturally.</p>
              </div>
              <button
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('candidate_session');
                    const session = raw ? JSON.parse(raw) : {};
                    router.push(session.candidate_id ? `/interview/${session.candidate_id}` : '/');
                  } catch { router.push('/'); }
                }}
                className="w-full py-4 rounded-lg text-white text-base font-medium transition-all duration-200 hover:shadow-[0_0_28px_rgba(139,92,246,0.45)] active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
              >
                Begin Interview →
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-zinc-800 text-xs">
          Nothing is recorded until the interview begins.
        </p>
      </div>
    </main>
  );
}
