'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import LiveCanvasWaveform, { type WaveState } from '@/components/LiveCanvasWaveform';

type InterviewState = 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'complete' | 'already_completed' | 'error';

const WS_URL             = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';
const SILENCE_THRESHOLD  = 0.012;
const BUFFER_SIZE        = 4096;
const SILENCE_DURATION_S = 0.8;
const MIN_SPEECH_CHUNKS  = 4;
const MAX_SECONDS        = 600;

function formatTime(s: number): string {
  const capped = Math.min(s, MAX_SECONDS);
  return `${Math.floor(capped / 60)}:${(capped % 60).toString().padStart(2, '0')}`;
}

async function resampleTo16k(chunks: Float32Array[], srcSampleRate: number): Promise<Float32Array> {
  const totalLen  = chunks.reduce((s, c) => s + c.length, 0);
  const combined  = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) { combined.set(c, offset); offset += c.length; }
  const targetLen  = Math.ceil(totalLen * 16000 / srcSampleRate);
  const offlineCtx = new OfflineAudioContext(1, targetLen, 16000);
  const audioBuf   = offlineCtx.createBuffer(1, totalLen, srcSampleRate);
  audioBuf.getChannelData(0).set(combined);
  const src = offlineCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offlineCtx.destination);
  src.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

const STATE_TO_WAVE: Record<string, WaveState> = {
  connecting: 'idle', ready: 'idle', listening: 'listening',
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
  const [activeAnalyser, setActiveAnalyser] = useState<AnalyserNode | null>(null);

  const stateRef             = useRef<InterviewState>('connecting');
  const wsRef                = useRef<WebSocket | null>(null);
  const audioCtxRef          = useRef<AudioContext | null>(null);
  const micAnalyserRef       = useRef<AnalyserNode | null>(null);
  const speakAnalyserRef     = useRef<AnalyserNode | null>(null);
  const processorRef         = useRef<ScriptProcessorNode | null>(null);
  const whisperRef           = useRef<any>(null);
  const recordingChunks      = useRef<Float32Array[]>([]);
  const isRecording          = useRef(false);
  const silenceCount         = useRef(0);
  const interviewCompleteRef = useRef(false);
  const timerRef             = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSourceRef     = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef        = useRef<ArrayBuffer[]>([]);
  const isQueuePlayingRef    = useRef(false);
  const turnEndReceivedRef   = useRef(false);
  const transcriptEndRef     = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const setIS = useCallback((s: InterviewState) => {
    stateRef.current = s;
    setInterviewState(s);
    if (s === 'complete' || s === 'error' || s === 'already_completed') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    if (s === 'listening') setActiveAnalyser(micAnalyserRef.current);
    else if (s !== 'speaking') setActiveAnalyser(null);
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

    const boot = async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      whisperRef.current = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
      if (cancelled) return;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current  = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'init_session', candidate_id: params.id, name: session.name ?? '', email: session.email ?? '' }));
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
          case 'already_completed': setIS('already_completed'); wsRef.current?.close(); break;
          case 'interview_complete': interviewCompleteRef.current = true; break;
          case 'interview_results':
            if (audioCtxRef.current) await playChime(audioCtxRef.current);
            wsRef.current?.close();
            router.push(`/results/${params.id}`);
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
    };

    boot().catch(() => { if (!cancelled) { setErrorMsg('Failed to initialize. Please refresh.'); setIS('error'); } });

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
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

    const silenceFramesNeeded = Math.ceil((SILENCE_DURATION_S * ctx.sampleRate) / BUFFER_SIZE);
    const maxRecordChunks     = Math.floor((45 * ctx.sampleRate) / BUFFER_SIZE);

    processor.onaudioprocess = (e) => {
      if (stateRef.current !== 'listening') { isRecording.current = false; silenceCount.current = 0; return; }
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      const rms     = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
      if (rms > SILENCE_THRESHOLD) {
        silenceCount.current = 0;
        if (!isRecording.current) { isRecording.current = true; recordingChunks.current = []; }
        recordingChunks.current.push(samples.slice());
      } else if (isRecording.current) {
        recordingChunks.current.push(samples.slice());
        silenceCount.current++;
        if (silenceCount.current >= silenceFramesNeeded) {
          const chunks = recordingChunks.current.slice();
          isRecording.current = false; recordingChunks.current = []; silenceCount.current = 0;
          if (chunks.length >= MIN_SPEECH_CHUNKS) { setIS('thinking'); transcribeAndSend(chunks, ctx.sampleRate); }
          return;
        }
      }
      if (isRecording.current && recordingChunks.current.length >= maxRecordChunks) {
        const chunks = recordingChunks.current.slice();
        isRecording.current = false; recordingChunks.current = []; silenceCount.current = 0;
        setIS('thinking'); transcribeAndSend(chunks, ctx.sampleRate);
      }
    };
  };

  const beginInterview = async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    await ctx.resume();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    wsRef.current?.send(JSON.stringify({ type: 'start_interview' }));
  };

  const handleEndInterview = () => {
    if (!wsRef.current) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (currentSourceRef.current) { try { currentSourceRef.current.stop(); } catch { /* stopped */ } currentSourceRef.current = null; }
    speakAnalyserRef.current   = null;
    audioQueueRef.current      = [];
    isQueuePlayingRef.current  = false;
    turnEndReceivedRef.current = false;
    interviewCompleteRef.current = true;
    setIS('complete');
    wsRef.current.send(JSON.stringify({ type: 'end_interview' }));
  };

  const transcribeAndSend = async (chunks: Float32Array[], sampleRate: number) => {
    try {
      const resampled = await resampleTo16k(chunks, sampleRate);
      const result    = await whisperRef.current(resampled, { sampling_rate: 16000, chunk_length_s: 30, stride_length_s: 5 });
      const text = (result?.text || '').trim().replace(/^[\s,.'"`]+/, '');
      if (text.length > 1) { setTranscript((t) => [...t, { role: 'user', text }]); wsRef.current?.send(JSON.stringify({ type: 'user_message', text })); }
      else setIS('listening');
    } catch { setIS('listening'); }
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
    else { setIS('listening'); recordingChunks.current = []; isRecording.current = false; silenceCount.current = 0; }
  };

  const drainQueue = async () => {
    if (isQueuePlayingRef.current) return;
    isQueuePlayingRef.current = true;
    while (audioQueueRef.current.length > 0) { await playChunk(audioQueueRef.current.shift()!); }
    isQueuePlayingRef.current = false;
    if (turnEndReceivedRef.current) await finalizeTurn();
  };

  const enqueueAudio = (buffer: ArrayBuffer) => { audioQueueRef.current.push(buffer); void drainQueue(); };

  const isInterviewActive = ['listening', 'thinking', 'speaking'].includes(interviewState);
  const timerWarning      = elapsed >= 480;
  const waveState         = STATE_TO_WAVE[interviewState] ?? 'idle';

  return (
    <main className="h-screen flex flex-col overflow-hidden relative bg-[#09090B]">

      {/* ── Timer — fixed top-left ────────────────────────────────────────── */}
      {isInterviewActive && (
        <div
          className="fixed top-5 left-6 z-30 flex items-center gap-2 px-3.5 py-2 rounded-lg"
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
        <div className="fixed top-5 right-6 z-30">
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

            {interviewState === 'connecting' && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-6 h-6 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
                <span className="text-zinc-600 text-xs tracking-[0.18em] uppercase">Initializing</span>
              </div>
            )}

            {interviewState === 'ready' && (
              <div className="flex flex-col items-center gap-8 text-center">
                <div className="space-y-2">
                  <p className="text-3xl font-bold text-white">Ready for you.</p>
                  <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
                    When you click Begin, Maya will ask the first question out loud.
                  </p>
                </div>
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
              </div>
            )}

            {interviewState === 'complete' && (
              <div className="flex flex-col items-center gap-6 text-center">
                <div className="w-6 h-6 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
                <div className="space-y-2">
                  <p className="text-2xl font-bold text-white">Finalizing your results…</p>
                  <p className="text-zinc-500 text-sm">Scoring your responses — this takes about 15 seconds.</p>
                </div>
              </div>
            )}

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
          <div className="flex-shrink-0 text-center px-6 py-6">
            <div className="max-w-3xl mx-auto">
              <p className="text-[10px] font-medium tracking-[0.28em] text-zinc-700 uppercase mb-4">
                Maya{questionNum ? ` · Q${questionNum}` : ''}
              </p>
              <p className="text-2xl font-semibold text-white leading-relaxed">
                {currentText || ' '}
              </p>
              {interviewState === 'thinking' && (
                <div className="mt-4 flex justify-center">
                  <ThinkingDots />
                </div>
              )}
            </div>
          </div>

          {/* CENTER: Waveform */}
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="relative w-full max-w-lg flex items-center justify-center">
              {interviewState === 'speaking' && (
                <div
                  className="absolute inset-0 rounded-full blur-3xl pointer-events-none"
                  style={{
                    background: 'radial-gradient(ellipse at center, rgba(168,85,247,0.22) 0%, transparent 70%)',
                    animation:  'speakBloom 1.8s ease-in-out infinite',
                  }}
                />
              )}
              <LiveCanvasWaveform
                analyserNode={activeAnalyser}
                state={waveState}
                className="h-[150px]"
              />
            </div>
            {interviewState !== 'thinking' && (
              <p className="text-[10px] font-medium tracking-[0.24em] text-zinc-700 uppercase">
                {interviewState === 'listening' ? 'Listening'
                : interviewState === 'speaking'  ? 'Speaking'
                : ''}
              </p>
            )}
            {interviewState === 'listening' && (
              <p className="text-zinc-700 text-xs text-center">
                Speak when ready — I'll listen until you naturally pause.
              </p>
            )}
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

    </main>
  );
}
