'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import LiveCanvasWaveform, { type WaveState } from '@/components/LiveCanvasWaveform';

type InterviewState = 'connecting' | 'ready' | 'starting' | 'listening' | 'thinking' | 'speaking' | 'complete' | 'already_completed' | 'error';

const WS_URL             = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';
const SILENCE_THRESHOLD  = 0.012;
const BUFFER_SIZE        = 4096;
const SILENCE_DURATION_S = 0.55;
const MIN_SPEECH_CHUNKS  = 4;
const MAX_SECONDS        = 600;

function formatTime(s: number): string {
  const capped = Math.min(s, MAX_SECONDS);
  return `${Math.floor(capped / 60)}:${(capped % 60).toString().padStart(2, '0')}`;
}


const STATE_TO_WAVE: Record<string, WaveState> = {
  connecting: 'idle', ready: 'idle', starting: 'idle', listening: 'listening',
  thinking: 'thinking', speaking: 'speaking', complete: 'idle',
  already_completed: 'idle', error: 'idle',
};

function ThinkingDots() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium tracking-[0.22em] text-violet-500/60 uppercase">Processing</span>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: 'rgba(168,85,247,0.75)',
              boxShadow:  '0 0 5px rgba(168,85,247,0.55)',
              animation:  `thinkDot 1.2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function InterviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();

  const [interviewState, setInterviewState] = useState<InterviewState>('connecting');
  const [currentText,    setCurrentText]    = useState('');
  const [questionNum,    setQuestionNum]    = useState<number | null>(null);
  const [transcript,     setTranscript]     = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [errorMsg,       setErrorMsg]       = useState('');
  const [elapsed,        setElapsed]        = useState(0);
  const [activeAnalyser,  setActiveAnalyser]  = useState<AnalyserNode | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [resumeCountdown,  setResumeCountdown]  = useState<number | null>(null);
  const [startCountdown,   setStartCountdown]   = useState<number | null>(null);
  const startCdTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scoringCountdown, setScoringCountdown] = useState<number>(15);
  const scoringTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const [micVolume,  setMicVolume]  = useState(0);
  const micVolumeRafRef = useRef<number>(0);
  const [candidateName,   setCandidateName]   = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = localStorage.getItem('candidate_session');
      return raw ? (JSON.parse(raw).name ?? '') : '';
    } catch { return ''; }
  });

  const stateRef             = useRef<InterviewState>('connecting');
  const wsRef                = useRef<WebSocket | null>(null);
  const audioCtxRef          = useRef<AudioContext | null>(null);
  const micAnalyserRef       = useRef<AnalyserNode | null>(null);
  const speakAnalyserRef     = useRef<AnalyserNode | null>(null);
  const processorRef         = useRef<ScriptProcessorNode | null>(null);
  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const shouldSendAudioRef   = useRef(false);
  const isRecording          = useRef(false);
  const silenceCount         = useRef(0);
  const interviewCompleteRef = useRef(false);
  const timerRef             = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSourceRef     = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef        = useRef<ArrayBuffer[]>([]);
  const isQueuePlayingRef    = useRef(false);
  const turnEndReceivedRef   = useRef(false);
  const transcriptEndRef     = useRef<HTMLDivElement | null>(null);
  const countdownTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef          = useRef(false);
  const heartbeatRef         = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  useEffect(() => {
    if (interviewState !== 'listening' || !activeAnalyser) {
      setMicVolume(0);
      cancelAnimationFrame(micVolumeRafRef.current);
      return;
    }
    const tick = () => {
      const data = new Uint8Array(activeAnalyser.frequencyBinCount);
      activeAnalyser.getByteFrequencyData(data);
      const rms = data.reduce((s, v) => s + v * v, 0) / data.length;
      setMicVolume(Math.min(1, Math.sqrt(rms) / 10));
      micVolumeRafRef.current = requestAnimationFrame(tick);
    };
    micVolumeRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(micVolumeRafRef.current);
  }, [interviewState, activeAnalyser]);

  useEffect(() => {
    if (interviewState !== 'complete') return;
    setScoringCountdown(15);
    scoringTimerRef.current = setInterval(() => {
      setScoringCountdown((n) => {
        if (n <= 1) { clearInterval(scoringTimerRef.current!); scoringTimerRef.current = null; return 0; }
        return n - 1;
      });
    }, 1000);
    return () => { if (scoringTimerRef.current) { clearInterval(scoringTimerRef.current); scoringTimerRef.current = null; } };
  }, [interviewState]);

  const setIS = useCallback((s: InterviewState) => {
    stateRef.current = s;
    setInterviewState(s);
    if (s === 'complete' || s === 'error' || s === 'already_completed') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    if (s === 'listening') {
      setActiveAnalyser(micAnalyserRef.current);
      // Keep the WebSocket alive through Render's proxy idle-timeout by sending a
      // ping every 20 s. Without this the proxy drops the connection after ~30–60 s
      // of silence, the browser never notices (no onclose handling), and the next
      // audio send silently fails — leaving the UI permanently stuck in 'thinking'.
      if (!heartbeatRef.current) {
        heartbeatRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20_000);
      }
    } else {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (s !== 'speaking') setActiveAnalyser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let session: { candidate_id?: string; name?: string; email?: string } = {};
    try {
      const raw = localStorage.getItem('candidate_session');
      session   = raw ? JSON.parse(raw) : {};
    } catch { /* malformed */ }

    if (!session.candidate_id || session.candidate_id !== params.id) {
      router.replace('/');
      return;
    }

    if (session.name) setCandidateName(session.name);

    const boot = async () => {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current  = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'init_session',
          candidate_id: params.id,
          name:  session.name  ?? '',
          email: session.email ?? '',
          invite_token: (session as any).invite_token ?? null,
        }));
      };

      ws.onmessage = async (e) => {
        if (e.data instanceof ArrayBuffer) { enqueueAudio(e.data); return; }
        const msg = JSON.parse(e.data as string);

        switch (msg.type) {
          case 'connected':     await startMic(); setIS('ready'); break;
          case 'thinking':      setIS('thinking'); break;
          case 'audio_chunk':
            if (msg.first) { setCurrentText(msg.sentence); if (msg.question) setQuestionNum(msg.question); }
            break;
          case 'turn_end':
            if (msg.full_text) { setCurrentText(msg.full_text); setTranscript((t) => [...t, { role: 'ai', text: msg.full_text }]); }
            turnEndReceivedRef.current = true;
            if (!isQueuePlayingRef.current && audioQueueRef.current.length === 0) await finalizeTurn();
            break;
          case 'already_completed':
            wsRef.current?.close();
            if (msg.candidate_id) { router.replace(`/results/${msg.candidate_id}`); }
            else { setIS('already_completed'); }
            break;
          case 'interview_complete': interviewCompleteRef.current = true; break;
          case 'interview_results':
            if (audioCtxRef.current) await playChime(audioCtxRef.current);
            wsRef.current?.close();
            router.push(`/results/${params.id}`);
            break;
          case 'transcription':
            setTranscript((t) => [...t, { role: 'user', text: msg.text }]);
            break;
          case 'ready_for_input':
            setIS('listening');
            break;
          case 'error':
            setErrorMsg(msg.message || 'Something went wrong. Please refresh.');
            setIS('error');
            break;
        }
      };

      ws.onerror = () => {
        if (!cancelled) { setErrorMsg('Connection lost. Please refresh to reconnect.'); setIS('error'); }
      };

      ws.onclose = () => {
        if (!cancelled && stateRef.current !== 'complete' && stateRef.current !== 'already_completed') {
          setErrorMsg('Connection lost. Please refresh to reconnect.');
          setIS('error');
        }
      };
    };

    boot().catch(() => { if (!cancelled) { setErrorMsg('Failed to initialize. Please refresh.'); setIS('error'); } });

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (startCdTimerRef.current) clearInterval(startCdTimerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (scoringTimerRef.current) clearInterval(scoringTimerRef.current);
      cancelAnimationFrame(micVolumeRafRef.current);
      wsRef.current?.close();
      processorRef.current?.disconnect();
      audioCtxRef.current?.close();
    };
  }, [setIS, params.id, router]);

  const startMic = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    const source      = ctx.createMediaStreamSource(stream);
    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.8;
    source.connect(micAnalyser);
    micAnalyserRef.current = micAnalyser;

    const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    source.connect(processor);
    processorRef.current = processor;
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    // MediaRecorder captures WebM/Opus for cloud STT — ScriptProcessor handles VAD only.
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (shouldSendAudioRef.current && e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => wsRef.current?.send(buf));
      }
      shouldSendAudioRef.current = false;
    };

    const silenceFramesNeeded = Math.ceil((SILENCE_DURATION_S * ctx.sampleRate) / BUFFER_SIZE);
    const maxSpeechChunks     = Math.floor((45 * ctx.sampleRate) / BUFFER_SIZE);
    let speechChunkCount = 0;

    processor.onaudioprocess = (e) => {
      if (stateRef.current !== 'listening') {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        isRecording.current = false; silenceCount.current = 0; speechChunkCount = 0;
        return;
      }
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      const rms     = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
      if (rms > SILENCE_THRESHOLD) {
        silenceCount.current = 0;
        if (!isRecording.current) {
          isRecording.current = true;
          speechChunkCount = 0;
          if (mediaRecorder.state === 'inactive') mediaRecorder.start();
        }
        speechChunkCount++;
      } else if (isRecording.current) {
        silenceCount.current++;
        if (silenceCount.current >= silenceFramesNeeded) {
          isRecording.current = false; silenceCount.current = 0;
          if (speechChunkCount >= MIN_SPEECH_CHUNKS) {
            speechChunkCount = 0;
            setIS('thinking');
            shouldSendAudioRef.current = true;
          } else {
            speechChunkCount = 0;
          }
          if (mediaRecorder.state === 'recording') mediaRecorder.stop();
          return;
        }
      }
      if (isRecording.current && speechChunkCount >= maxSpeechChunks) {
        isRecording.current = false; silenceCount.current = 0; speechChunkCount = 0;
        setIS('thinking');
        shouldSendAudioRef.current = true;
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }
    };
  };

  const beginInterview = () => {
    setIS('starting');

    // Show 3-2-1 countdown immediately so there's no dead silence after the click
    setStartCountdown(3);
    let count = 3;
    startCdTimerRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(startCdTimerRef.current!);
        startCdTimerRef.current = null;
        setStartCountdown(null);
      } else {
        setStartCountdown(count);
      }
    }, 1000);

    // Resume audio context and fire the WS message in parallel with the countdown
    (async () => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      await ctx.resume();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      wsRef.current?.send(JSON.stringify({ type: 'start_interview' }));
    })();
  };

  const killAudio = () => {
    if (currentSourceRef.current) { try { currentSourceRef.current.stop(); } catch { /* stopped */ } currentSourceRef.current = null; }
    audioQueueRef.current      = [];
    isQueuePlayingRef.current  = false;
    turnEndReceivedRef.current = false;  // prevent stale finalizeTurn when drainQueue unblocks
    speakAnalyserRef.current   = null;
    setActiveAnalyser(null);
  };

  const handleEndInterview = () => {
    killAudio();
    isPausedRef.current = true;
    audioCtxRef.current?.suspend();
    setShowQuitConfirm(true);
  };

  const confirmEndInterview = () => {
    setShowQuitConfirm(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    turnEndReceivedRef.current   = false;
    interviewCompleteRef.current = true;
    setIS('complete');
    wsRef.current?.send(JSON.stringify({ type: 'end_interview' }));
  };

  const resumeInterview = () => {
    setShowQuitConfirm(false);
    let count = 3;
    setResumeCountdown(count);
    countdownTimerRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownTimerRef.current!);
        countdownTimerRef.current = null;
        setResumeCountdown(null);
        isPausedRef.current = false;
        // Await the context resume before setting state or triggering the backend,
        // so the audio pipeline is fully running before new chunks are decoded.
        (audioCtxRef.current?.resume() ?? Promise.resolve()).then(() => {
          setIS('thinking');
          wsRef.current?.send(JSON.stringify({
            type: 'user_message',
            text: '(System Note: The candidate paused the interview briefly but has now resumed. Please continue naturally from where you left off.)',
          }));
        });
      } else {
        setResumeCountdown(count);
      }
    }, 1000);
  };

  const playChime = (ctx: AudioContext): Promise<void> =>
    new Promise((resolve) => {
      const now = ctx.currentTime;
      [659.25, 830.61].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
        const t = now + i * 0.18;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.start(t); osc.stop(t + 0.45);
      });
      setTimeout(resolve, 750);
    });

  const playChunk = async (arrayBuffer: ArrayBuffer): Promise<void> => {
    const ctx = audioCtxRef.current!;
    if (ctx.state !== 'running') await ctx.resume();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const source      = ctx.createBufferSource();
      source.buffer     = audioBuffer;
      currentSourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      speakAnalyserRef.current = analyser;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      setActiveAnalyser(analyser);
      setInterviewState('speaking');
      stateRef.current = 'speaking';

      await new Promise<void>((resolve) => {
        source.start();
        source.onended = () => {
          currentSourceRef.current = null;
          speakAnalyserRef.current = null;
          resolve();
        };
      });
    } catch { /* skip undecodable */ }
  };

  const finalizeTurn = async () => {
    turnEndReceivedRef.current = false;
    const ctx = audioCtxRef.current;
    if (ctx) await playChime(ctx);
    if (interviewCompleteRef.current) { setIS('complete'); }
    else { setIS('listening'); isRecording.current = false; silenceCount.current = 0; }
  };

  const drainQueue = async () => {
    if (isQueuePlayingRef.current) return;
    isQueuePlayingRef.current = true;
    try {
      while (audioQueueRef.current.length > 0) { await playChunk(audioQueueRef.current.shift()!); }
    } finally {
      isQueuePlayingRef.current = false;
      if (turnEndReceivedRef.current) await finalizeTurn();
    }
  };

  const enqueueAudio = (buffer: ArrayBuffer) => {
    if (isPausedRef.current) return;
    audioQueueRef.current.push(buffer);
    void drainQueue();
  };

  const isInterviewActive = ['listening', 'thinking', 'speaking'].includes(interviewState);
  const timerWarning      = elapsed >= 480;
  const waveState         = STATE_TO_WAVE[interviewState] ?? 'idle';

  return (
    <main className="h-screen flex flex-col overflow-hidden relative bg-[#09090B]">
      <style>{`
        @keyframes orbPulse {
          0%   { transform: scale(1);   opacity: 0.65; }
          100% { transform: scale(2.1); opacity: 0; }
        }
        @keyframes orbBreathe {
          0%, 100% { transform: scale(0.97); }
          50%       { transform: scale(1.03); }
        }
        @keyframes orbGlow {
          0%, 100% { box-shadow: 0 0 28px rgba(139,92,246,0.52), 0 0 56px rgba(139,92,246,0.20); }
          50%       { box-shadow: 0 0 52px rgba(139,92,246,0.80), 0 0 95px rgba(139,92,246,0.38); }
        }
        @keyframes pillPulse {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 0px rgba(16,185,129,0); }
          50%       { transform: scale(1.03); box-shadow: 0 0 18px rgba(16,185,129,0.35); }
        }
        @keyframes badgeSlideIn {
          from { opacity: 0; transform: translateY(-5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes yourTurnFlash {
          0%   { opacity: 1; }
          50%  { opacity: 0.32; }
          100% { opacity: 1; }
        }
        @keyframes avatarGlow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(139,92,246,0.30), 0 0 14px rgba(139,92,246,0.45); }
          50%       { box-shadow: 0 0 0 4px rgba(139,92,246,0.48), 0 0 28px rgba(139,92,246,0.72); }
        }
      `}</style>

      {/* ── Timer — fixed below global NOVA header ───────────────────────── */}
      {isInterviewActive && (
        <div
          className="fixed top-16 left-6 z-30 flex items-center gap-2 px-3.5 py-2 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(14px)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
            style={{ backgroundColor: timerWarning ? '#EF4444' : '#10B981' }}
          />
          <span
            className="text-sm font-semibold tabular-nums transition-colors duration-700"
            style={{ color: timerWarning ? '#EF4444' : '#FAFAFA' }}
          >
            {formatTime(elapsed)}
          </span>
          <span className="text-xs text-zinc-600 tabular-nums">/ 10:00</span>
        </div>
      )}

      {/* ── End Interview — fixed top-right ──────────────────────────────── */}
      {isInterviewActive && (
        <div className="fixed top-16 right-6 z-30">
          <button
            onClick={handleEndInterview}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 hover:bg-red-500/20 hover:border-red-500/50 active:scale-[0.97]"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      '#FCA5A5',
              backdropFilter: 'blur(14px)',
            }}
          >
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: '#EF4444' }} />
            End Interview
          </button>
        </div>
      )}

      {/* ── Non-active states — vertically centered ───────────────────────── */}
      {!isInterviewActive && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-8 w-full max-w-2xl px-6 animate-fade-in">

            {(interviewState === 'connecting' || interviewState === 'ready' || interviewState === 'starting') && (
              <div className="flex flex-col items-center gap-8 text-center">
                {/* Greeting — visible from the moment the page opens */}
                <div className="space-y-3">
                  <p className="text-3xl font-bold text-white">
                    Hey{candidateName ? `, ${candidateName.split(' ')[0]}` : ''}!
                  </p>
                  <p className="text-zinc-400 text-base leading-relaxed max-w-sm">
                    Welcome to your interview. Take a deep breath, relax — just speak naturally and be yourself.
                  </p>
                </div>

                {/* State-specific sub-content */}
                {interviewState === 'connecting' && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
                    <span className="text-zinc-600 text-xs tracking-[0.18em] uppercase">Setting up…</span>
                  </div>
                )}

                {interviewState === 'ready' && (
                  <button
                    onClick={beginInterview}
                    className="flex items-center gap-2.5 px-8 py-3.5 rounded-full text-sm font-semibold text-white transition-all duration-200 hover:shadow-[0_0_28px_rgba(139,92,246,0.45)] active:scale-[0.98]"
                    style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
                  >
                    Begin Interview
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}

                {interviewState === 'starting' && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    <span className="text-[10px] font-medium tracking-[0.22em] text-zinc-600 uppercase">Maya is getting ready…</span>
                  </div>
                )}
              </div>
            )}

            {interviewState === 'complete' && (() => {
              const TOTAL       = 15;
              const radius      = 40;
              const circumference = 2 * Math.PI * radius;
              const progress    = scoringCountdown / TOTAL;
              const dashOffset  = circumference * (1 - progress);
              const atZero      = scoringCountdown === 0;
              const message     =
                scoringCountdown >= 11 ? 'Analyzing your responses…'
                : scoringCountdown >= 7  ? 'Evaluating each dimension…'
                : scoringCountdown >= 3  ? 'Reviewing your teaching instincts…'
                :                          'Almost ready…';
              return (
                <div className="flex flex-col items-center gap-7 text-center">

                  {/* Circular progress ring */}
                  <div className="relative flex items-center justify-center" style={{ width: 100, height: 100 }}>
                    <svg width="100" height="100" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                      {/* Track */}
                      <circle
                        cx="50" cy="50" r={radius}
                        fill="none"
                        stroke="rgba(139,92,246,0.12)"
                        strokeWidth="5"
                      />
                      {/* Progress arc */}
                      <circle
                        cx="50" cy="50" r={radius}
                        fill="none"
                        stroke={atZero ? 'rgba(139,92,246,0.35)' : '#8B5CF6'}
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        style={{ transition: 'stroke-dashoffset 0.9s linear', filter: atZero ? 'none' : 'drop-shadow(0 0 6px rgba(139,92,246,0.70))' }}
                      />
                    </svg>

                    {/* Center content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                      {atZero ? (
                        <div className="w-4 h-4 rounded-full border border-violet-500/40 border-t-violet-400 animate-spin" />
                      ) : (
                        <>
                          <span className="text-2xl font-black tabular-nums text-white leading-none">{scoringCountdown}</span>
                          <span className="text-[9px] text-zinc-600 font-medium tracking-wider uppercase">sec</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Message */}
                  <div className="space-y-1.5">
                    <p className="text-xl font-bold text-white">{message}</p>
                    <p className="text-zinc-600 text-xs">Your interview is being scored by AI.</p>
                  </div>

                  {/* Warning pill */}
                  <div
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium"
                    style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.25)', color: '#FCD34D' }}
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    Please keep this tab open
                  </div>

                </div>
              );
            })()}

            {interviewState === 'already_completed' && (
              <div className="flex flex-col items-center gap-6 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <svg className="w-7 h-7 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <p className="text-2xl font-bold text-white">You've already been here.</p>
                  <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">Our records show you've completed this assessment. Your results have already been shared with the team.</p>
                </div>
                <button onClick={() => router.push('/')} className="text-xs text-zinc-700 underline hover:text-zinc-400 transition-colors">Return to home</button>
              </div>
            )}

            {interviewState === 'error' && (
              <div className="text-center space-y-3">
                <p className="text-red-400 text-sm leading-relaxed">{errorMsg}</p>
                <button onClick={() => window.location.reload()} className="text-xs text-zinc-600 underline hover:text-zinc-400 transition-colors">Refresh page</button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Active interview — 3-panel layout ────────────────────────────── */}
      {isInterviewActive && (
        <div className="flex flex-col h-full pt-24">

          {/* TOP: Current AI question — sits below fixed navbar/controls */}
          <div className="flex-shrink-0 text-center px-6 py-3">
            <div className="max-w-3xl mx-auto">
              <p className="text-[10px] font-medium tracking-[0.28em] text-zinc-700 uppercase mb-2">
                Maya{questionNum ? ` · Q${questionNum}` : ''}
              </p>
              <div className="relative max-h-[96px] overflow-y-auto">
                <p className="text-lg font-semibold text-white leading-relaxed">
                  {currentText || ' '}
                </p>
                <div className="pointer-events-none sticky bottom-0 h-5 bg-gradient-to-t from-[#09090B] to-transparent" />
              </div>

            </div>
          </div>

          {/* CENTER: Conversational Orb */}
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">

            {/* State label */}
            <div style={{ minHeight: 28 }} className="flex items-center justify-center">
              {interviewState === 'speaking' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-violet-400">🎙 Nova</span>
                  <span className="text-zinc-700 text-xs">·</span>
                  <span className="text-xs text-zinc-500">Speaking</span>
                  <div className="flex items-center gap-1 ml-1">
                    {[0,1,2].map((i) => (
                      <div key={i} className="w-1 h-1 rounded-full bg-violet-500"
                           style={{ animation: `thinkDot 1.2s ease-in-out ${i*0.18}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              {interviewState === 'listening' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-400">🎤 Your turn</span>
                  <span className="text-zinc-700 text-xs">·</span>
                  <span className="text-xs text-zinc-500">speak when ready</span>
                </div>
              )}
              {interviewState === 'thinking' && <ThinkingDots />}
            </div>

            {/* Nova avatar */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  width: 48, height: 48,
                  background: 'linear-gradient(135deg, #4C1D95 0%, #6D28D9 50%, #8B5CF6 100%)',
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease, opacity 0.3s ease',
                  ...(interviewState === 'speaking' ? {
                    transform: 'scale(1.1)',
                    animation: 'avatarGlow 1.8s ease-in-out infinite',
                  } : interviewState === 'thinking' ? {
                    opacity: 0.55,
                  } : {}),
                }}
              >
                <span className="text-xl font-black text-white select-none leading-none">N</span>
              </div>
              <span
                className="text-[10px] font-medium tracking-widest uppercase transition-colors duration-300"
                style={{ color: interviewState === 'speaking' ? '#A78BFA' : '#3F3F46' }}
              >
                Nova
              </span>
            </div>

            {/* Orb */}
            <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>

              {/* Sonar pulse rings — speaking */}
              {interviewState === 'speaking' && [0,1,2].map((i) => (
                <div key={i} className="absolute rounded-full"
                     style={{
                       width: 180, height: 180,
                       border: '1.5px solid rgba(139,92,246,0.45)',
                       animation: `orbPulse 2.4s ease-out ${i * 0.8}s infinite`,
                     }}
                />
              ))}

              {/* Mic-reactive ring — listening */}
              {interviewState === 'listening' && (
                <div className="absolute rounded-full transition-all duration-75"
                     style={{
                       width:     180 + micVolume * 56,
                       height:    180 + micVolume * 56,
                       border:    `2px solid rgba(16,185,129,${0.35 + micVolume * 0.55})`,
                       boxShadow: `0 0 ${16 + micVolume * 36}px rgba(16,185,129,${0.18 + micVolume * 0.45})`,
                     }}
                />
              )}

              {/* Spinning ring — thinking */}
              {interviewState === 'thinking' && (
                <div className="absolute rounded-full animate-spin"
                     style={{
                       width: 186, height: 186,
                       border: '2px solid transparent',
                       borderTopColor: 'rgba(139,92,246,0.55)',
                       borderRightColor: 'rgba(139,92,246,0.20)',
                       animationDuration: '1.6s',
                     }}
                />
              )}

              {/* Orb core */}
              <div
                className="relative rounded-full flex items-center justify-center"
                style={{
                  width: 160, height: 160,
                  transition: 'background 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease',
                  ...(interviewState === 'speaking' ? {
                    background: 'linear-gradient(135deg, #5B21B6 0%, #7C3AED 45%, #A855F7 100%)',
                    animation: 'orbGlow 1.8s ease-in-out infinite',
                  } : interviewState === 'listening' ? {
                    background: 'linear-gradient(135deg, #065F46 0%, #059669 50%, #10B981 100%)',
                    boxShadow: `0 0 ${28 + micVolume * 32}px rgba(16,185,129,${0.38 + micVolume * 0.35}), 0 0 ${55 + micVolume*45}px rgba(16,185,129,${0.14 + micVolume*0.22})`,
                  } : interviewState === 'thinking' ? {
                    background: 'radial-gradient(circle, rgba(39,39,42,0.85), rgba(18,18,20,0.95))',
                    border: '1px solid rgba(255,255,255,0.06)',
                    opacity: 0.65,
                  } : {
                    background: 'radial-gradient(circle, rgba(55,48,71,0.9) 0%, rgba(24,24,27,1) 100%)',
                    border: '1px solid rgba(139,92,246,0.18)',
                    animation: 'orbBreathe 3s ease-in-out infinite',
                  }),
                }}
              >
                {/* Icon inside orb */}
                {interviewState === 'listening' && (
                  <svg className="w-14 h-14 text-white/75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
                {interviewState === 'speaking' && (
                  <div className="flex items-end gap-1.5">
                    {[10,22,16,28,12].map((h, i) => (
                      <div key={i} className="rounded-full bg-white/65"
                           style={{ width: 3.5, height: h,
                                    animation: `thinkDot ${0.75 + i * 0.14}s ease-in-out ${i * 0.12}s infinite` }}
                      />
                    ))}
                  </div>
                )}
                {(interviewState === 'connecting' || interviewState === 'ready' || interviewState === 'starting') && (
                  <span className="text-4xl font-black text-white/20 select-none">N</span>
                )}
              </div>

            </div>

            {/* Thin waveform strip — only during audio states */}
            {(interviewState === 'speaking' || interviewState === 'listening') && (
              <div className="opacity-35 w-full max-w-[220px]">
                <LiveCanvasWaveform
                  analyserNode={activeAnalyser}
                  state={waveState}
                  className="h-[28px]"
                />
              </div>
            )}

            {/* State pill badge */}
            <div className="flex items-center justify-center" style={{ minHeight: 44 }}>

              {interviewState === 'speaking' && (
                <div
                  className="flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
                  style={{ background: 'rgba(109,40,217,0.28)', border: '1px solid rgba(139,92,246,0.45)', animation: 'badgeSlideIn 0.25s ease' }}
                >
                  🎙 Nova is speaking
                </div>
              )}

              {interviewState === 'listening' && micVolume < 0.12 && (
                <div
                  className="flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
                  style={{
                    background: 'rgba(5,150,105,0.22)',
                    border: '1px solid rgba(16,185,129,0.45)',
                    animation: 'badgeSlideIn 0.25s ease, yourTurnFlash 0.45s ease 0.15s 1, pillPulse 2s ease-in-out 0.65s infinite',
                  }}
                >
                  🎤 Your turn — speak now
                </div>
              )}

              {interviewState === 'listening' && micVolume >= 0.12 && (
                <div
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium"
                  style={{ background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.35)', color: '#93C5FD' }}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                  Listening · keep going
                </div>
              )}

              {interviewState === 'thinking' && (
                <div
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium"
                  style={{ background: 'rgba(39,39,42,0.75)', border: '1px solid rgba(255,255,255,0.07)', color: '#71717A', animation: 'badgeSlideIn 0.25s ease' }}
                >
                  Analyzing what you said…
                </div>
              )}

            </div>

          </div>

          {/* BOTTOM: Scrollable chat transcript — 40% of screen height */}
          <div
            className="flex-shrink-0"
            style={{ height: '40vh', borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="h-full overflow-y-auto px-6 py-4 space-y-3">
              {transcript.length === 0 && (
                <p className="text-zinc-800 text-xs text-center py-3">
                  Conversation will appear here…
                </p>
              )}
              {transcript.map((entry, i) => (
                <div key={i} className={`flex gap-2.5 ${entry.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white mt-0.5"
                    style={{
                      background: entry.role === 'ai' ? 'rgba(139,92,246,0.35)' : 'rgba(59,130,246,0.35)',
                      border:     `1px solid ${entry.role === 'ai' ? 'rgba(139,92,246,0.45)' : 'rgba(59,130,246,0.45)'}`,
                    }}
                  >
                    {entry.role === 'ai' ? 'M' : 'Y'}
                  </div>
                  <div
                    className="max-w-[75%] px-3.5 py-2 rounded-xl text-xs leading-relaxed"
                    style={{
                      background: entry.role === 'user' ? 'rgba(59,130,246,0.09)' : 'rgba(139,92,246,0.07)',
                      border:     '1px solid rgba(255,255,255,0.07)',
                      color:      entry.role === 'user' ? '#D4D4D8' : '#A1A1AA',
                    }}
                  >
                    {entry.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>

        </div>
      )}

      {/* ── Quit Confirmation Modal ───────────────────────────────────────── */}
      {showQuitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
        >
          <div
            className="flex flex-col gap-6 p-8 rounded-2xl max-w-sm w-full mx-6 text-center"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <div className="space-y-2">
              <p className="text-xl font-bold text-white">End interview?</p>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Your responses will be scored and results shared with the team. This cannot be undone.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={confirmEndInterview}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)', border: '1px solid rgba(239,68,68,0.4)' }}
              >
                Yes, end interview
              </button>
              <button
                onClick={resumeInterview}
                className="w-full py-3 rounded-xl text-sm font-semibold text-zinc-300 transition-all duration-200 hover:bg-white/5 active:scale-[0.97]"
                style={{ border: '1px solid rgba(255,255,255,0.10)' }}
              >
                No, keep going
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resume Countdown Overlay ──────────────────────────────────────── */}
      {resumeCountdown !== null && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <span
            className="text-9xl font-black text-white tabular-nums"
            style={{ textShadow: '0 0 60px rgba(139,92,246,0.8)' }}
          >
            {resumeCountdown}
          </span>
        </div>
      )}

      {/* ── Begin Interview Countdown Overlay ────────────────────────────── */}
      {startCountdown !== null && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center pointer-events-none gap-5"
          style={{ background: 'rgba(9,9,11,0.82)', backdropFilter: 'blur(6px)' }}
        >
          <p className="text-xs font-medium tracking-[0.22em] uppercase text-zinc-500">
            Interview starting in
          </p>
          <span
            className="text-[120px] font-black text-white tabular-nums leading-none"
            style={{ textShadow: '0 0 80px rgba(139,92,246,0.75)' }}
          >
            {startCountdown}
          </span>
          <p className="text-sm text-zinc-600">Get ready — just speak naturally</p>
        </div>
      )}

    </main>
  );
}
