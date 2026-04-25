'use client';

import { useRouter } from 'next/navigation';
import { useState, FormEvent, useRef, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import ThemeToggle from '@/components/ThemeToggle';

const TICKER_SEP = ' '.repeat(15) + '◆' + ' '.repeat(15);
const TICKER_TEXT = `HIRING MATH TUTOR${TICKER_SEP}BEST VOICE INTERVIEW PLATFORM${TICKER_SEP}`;

const SKILLS = [
  { name: 'Empathy',               desc: 'Feeling what a stuck student feels.' },
  { name: 'Communication Clarity', desc: 'Simplifying, not lecturing.' },
  { name: 'Patience',              desc: 'Sitting with confusion without rushing.' },
  { name: 'Adaptability',          desc: 'Changing approach when needed.' },
  { name: 'English Fluency',       desc: 'Clear, natural expression — not your accent.' },
];

type MicState = 'idle' | 'requesting' | 'listening' | 'detected' | 'denied';

function validateEmail(email: string): string | null {
  if (email.length > 254) return 'Email must be 254 characters or fewer.';
  if (/\s/.test(email))   return 'Email must not contain spaces.';

  const atMatches = email.match(/@/g);
  if (!atMatches)              return 'Email must contain "@".';
  if (atMatches.length > 1)    return 'Email must contain exactly one "@".';

  const [localPart, domain] = email.split('@');

  // ── Local part ──────────────────────────────────────────────────────────────
  if (!localPart)                          return 'Email local part (before @) must not be empty.';
  if (localPart.length > 64)               return 'Email local part must be 64 characters or fewer.';
  if (!/^[A-Za-z0-9._%+\-]+$/.test(localPart)) return 'Email contains invalid characters before "@".';
  if (localPart.startsWith('.'))           return 'Local part must not start with ".".';
  if (localPart.endsWith('.'))             return 'Local part must not end with ".".';
  if (localPart.includes('..'))            return 'Local part must not contain consecutive dots.';

  // ── Domain ───────────────────────────────────────────────────────────────────
  if (!domain)                    return 'Email domain (after @) must not be empty.';
  if (domain.length > 255)        return 'Email domain must be 255 characters or fewer.';
  if (!domain.includes('.'))      return 'Email domain must contain at least one ".".';
  if (domain.includes('..'))      return 'Email domain must not contain consecutive dots.';

  const labels = domain.split('.');
  for (const label of labels) {
    if (!label)                         return 'Email domain must not have empty labels.';
    if (!/^[A-Za-z0-9-]+$/.test(label)) return 'Email domain contains invalid characters.';
    if (label.startsWith('-'))          return 'Domain labels must not start with "-".';
    if (label.endsWith('-'))            return 'Domain labels must not end with "-".';
  }

  // ── TLD ──────────────────────────────────────────────────────────────────────
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]+$/.test(tld)) return 'TLD must contain only letters (e.g. .com, .in).';
  if (tld.length < 2)            return 'TLD must be at least 2 characters.';

  return null;
}

export default function LandingPage() {
  const router       = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Theme — only used for inline styles that can't use Tailwind dark:
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = !mounted || resolvedTheme !== 'light';

  // Form state
  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Waitlist state
  const [waitlistEmail,     setWaitlistEmail]     = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistError,     setWaitlistError]     = useState('');

  // Mic-first flow
  const [micState,  setMicState]  = useState<MicState>('idle');
  const [micBars,   setMicBars]   = useState<number[]>(new Array(40).fill(0));
  const micStreamRef   = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micRafRef      = useRef<number>(0);
  const detectedRef    = useRef(false);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(micRafRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micAudioCtxRef.current?.close();
    };
  }, []);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(micRafRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const requestMic = useCallback(async () => {
    setMicState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const ctx      = new AudioContext();
      micAudioCtxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);

      setMicState('listening');
      detectedRef.current = false;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 40 }, (_, i) => {
          const idx = Math.floor((i / 40) * data.length * 0.6);
          return data[idx] / 255;
        });
        setMicBars(bars);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;
        if (avg > 7 && !detectedRef.current) {
          detectedRef.current = true;
          setMicState('detected');
          setTimeout(() => nameInputRef.current?.focus(), 350);
        }
        micRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicState('denied');
    }
  }, []);

  const skipMicCheck = useCallback(() => {
    stopMic();
    setMicState('detected');
    setTimeout(() => nameInputRef.current?.focus(), 100);
  }, [stopMic]);

  const focusForm = () => {
    const el = document.getElementById('hero-form');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (micState === 'detected') {
      setTimeout(() => nameInputRef.current?.focus(), 380);
    } else {
      requestMic();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedName  = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError('Please enter your name.');
      nameInputRef.current?.focus();
      return;
    }
    const emailError = validateEmail(trimmedEmail);
    if (emailError) {
      setError(emailError);
      return;
    }
    stopMic();
    setSubmitting(true);
    const candidateId = crypto.randomUUID();
    localStorage.setItem(
      'candidate_session',
      JSON.stringify({ candidate_id: candidateId, name: trimmedName, email: trimmedEmail }),
    );
    router.push('/onboarding');
  };

  const handleWaitlist = (e: FormEvent) => {
    e.preventDefault();
    setWaitlistError('');
    if (!waitlistEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
      setWaitlistError('Enter a valid email to join.');
      return;
    }
    setWaitlistSubmitted(true);
  };

  const formVisible  = micState === 'detected';
  const showWaveform = micState === 'listening' || micState === 'detected';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090B] text-slate-900 dark:text-white">

      {/* ── Navbar ──────────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.06]"
        style={{
          background: isDark ? 'rgba(9,9,11,0.88)' : 'rgba(255,255,255,0.90)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <span />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={focusForm}
            className="text-sm font-bold text-white rounded-full px-6 py-2.5 transition-all duration-200 hover:scale-105 hover:shadow-[0_0_22px_rgba(139,92,246,0.50)] active:scale-[0.97]"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
          >
            Start Interview
          </button>
        </div>
      </nav>

      <main className="pt-14">

        {/* ── Floating Ticker ──────────────────────────────────────────────────── */}
        <div className="max-w-4xl mx-auto px-6 pt-3 pb-1">
          <div
            className="rounded-full overflow-hidden h-8 flex items-center"
            style={{
              background: 'rgba(12,12,15,0.94)',
              border: '1px solid rgba(255,255,255,0.09)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div
              className="flex items-center flex-shrink-0"
              style={{ animation: 'marquee 28s linear infinite', width: 'max-content' }}
            >
              <span className="whitespace-nowrap text-[10px] font-extrabold tracking-[0.22em] text-white uppercase px-6 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
                {TICKER_TEXT}
              </span>
              <span className="whitespace-nowrap text-[10px] font-extrabold tracking-[0.22em] text-white uppercase px-6 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" aria-hidden="true">
                {TICKER_TEXT}
              </span>
            </div>
          </div>
        </div>

        {/* ── Hero ────────────────────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pt-24 pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-start">

            {/* Left — copy */}
            <div className="space-y-8 animate-fade-in">
              <div className="space-y-5">
                <div className="text-8xl sm:text-9xl font-black text-slate-900 dark:text-white leading-none tracking-tight">
                  NOVA
                </div>
                <p className="text-[11px] font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-[0.18em]">
                  AI Interview Platform
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 dark:text-white leading-[1.1] tracking-tight">
                  We find tutors<br />who genuinely<br />care.
                </h1>
                <p className="text-slate-500 dark:text-zinc-200 text-base leading-relaxed">
                  Most screening stops at qualifications. We screen for empathy, patience, and the ability to connect with a child who is struggling. Nova is the AI interviewer built to find exactly that.
                </p>
              </div>

              <div className="h-px bg-slate-200 dark:bg-white/[0.07]" />

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Think you have what it takes?</p>
                <p className="text-slate-500 dark:text-zinc-200 text-sm leading-relaxed">
                  10 minutes. Voice only. No camera, no slides, no prep. If you are passionate about teaching kids, you might be exactly who we are looking for.
                </p>
                <p className="text-sm text-violet-500 dark:text-violet-400 font-medium">
                  You could be the next tutor we work with.
                </p>
              </div>

              <div className="border-l border-slate-200 dark:border-white/[0.08] pl-4">
                <p className="text-[11px] text-slate-400 dark:text-zinc-200 mb-1.5">The kind of question Nova asks</p>
                <p className="text-slate-500 dark:text-zinc-200 text-sm italic leading-relaxed">
                  "Tell me about a time a student was really struggling. What did you try, and did it work?"
                </p>
              </div>

              <button
                onClick={focusForm}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-12 py-6 rounded-2xl text-2xl font-bold text-white transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-[0_0_50px_rgba(139,92,246,0.50)]"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
              >
                Start Interview
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>

            {/* Right — mic-first form */}
            <div id="hero-form" className="animate-fade-in" style={{ animationDelay: '0.12s' }}>
              <div className="space-y-6">

                <div className="space-y-0.5">
                  <p className="text-base font-semibold text-slate-900 dark:text-white">Start your interview</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-300">Under 10 minutes. Voice only.</p>
                </div>

                {/* ── Mic test button (idle) ──────────────────────────────────── */}
                {micState === 'idle' && (
                  <div className="space-y-4">
                    <button
                      onClick={requestMic}
                      className="w-full flex items-center justify-center gap-3 py-5 rounded-xl text-base font-semibold text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                      style={{
                        background: 'linear-gradient(135deg, rgba(124,58,237,0.20) 0%, rgba(168,85,247,0.20) 100%)',
                        border: '1px solid rgba(139,92,246,0.35)',
                        boxShadow: isDark
                          ? '0 0 30px rgba(139,92,246,0.18), inset 0 0 30px rgba(139,92,246,0.05)'
                          : '0 0 18px rgba(139,92,246,0.14)',
                        color: isDark ? '#ffffff' : '#5b21b6',
                      }}
                    >
                      <svg className="w-5 h-5 text-violet-400 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      Test my microphone
                    </button>
                    <p className="text-xs text-slate-400 dark:text-zinc-400 text-center">
                      We check your audio quality before the interview begins.
                    </p>
                  </div>
                )}

                {/* ── Requesting ──────────────────────────────────────────────── */}
                {micState === 'requesting' && (
                  <div className="w-full flex items-center justify-center gap-3 py-5 rounded-xl bg-slate-100 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08]">
                    <div className="w-4 h-4 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
                    <span className="text-sm text-slate-500 dark:text-zinc-200">Requesting microphone access…</span>
                  </div>
                )}

                {/* ── Denied ──────────────────────────────────────────────────── */}
                {micState === 'denied' && (
                  <div className="space-y-3">
                    <div className="rounded-xl px-5 py-4 space-y-2 bg-red-50 dark:bg-red-500/[0.06] border border-red-200 dark:border-red-500/[0.25]">
                      <p className="text-sm text-red-500 dark:text-red-400 font-medium">Microphone access was denied.</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-300">Check your browser settings and allow mic access, then refresh.</p>
                    </div>
                    <button
                      onClick={skipMicCheck}
                      className="w-full text-xs text-slate-400 dark:text-zinc-300 hover:text-slate-600 dark:hover:text-zinc-400 underline transition-colors py-2"
                    >
                      Continue without mic check
                    </button>
                  </div>
                )}

                {/* ── Live waveform (listening / detected) ────────────────────── */}
                {showWaveform && (
                  <div className="rounded-xl px-5 py-4 space-y-3 bg-slate-100 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.07]">
                    <div className="flex items-center justify-center gap-[3px]" style={{ height: '48px' }}>
                      {micBars.map((bar, i) => (
                        <div
                          key={i}
                          className="rounded-full"
                          style={{
                            width: '3px',
                            height: `${Math.max(3, bar * 44)}px`,
                            backgroundColor: bar > 0.04
                              ? (micState === 'detected' ? '#10B981' : '#8B5CF6')
                              : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'),
                            transition: 'height 50ms ease-out, background-color 300ms',
                          }}
                        />
                      ))}
                    </div>

                    <div className="flex items-center justify-center gap-2">
                      {micState === 'detected' ? (
                        <>
                          <svg className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">Audio detected — fill in your details below</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-zinc-300">Say something to test your microphone…</span>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Form fields — expand after audio detected ────────────────── */}
                <div
                  className="overflow-hidden"
                  style={{
                    maxHeight:  formVisible ? '400px' : '0px',
                    opacity:    formVisible ? 1 : 0,
                    transition: 'max-height 0.55s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease',
                  }}
                >
                  <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-slate-500 dark:text-zinc-300 uppercase tracking-wider">
                          Your Name
                        </label>
                        <input
                          ref={nameInputRef}
                          type="text"
                          autoComplete="name"
                          value={name}
                          onChange={(e) => { setName(e.target.value); setError(''); }}
                          placeholder="e.g. Priya Sharma"
                          className="w-full bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.10] rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-violet-400 dark:focus:border-violet-500/50 focus:bg-white dark:focus:bg-white/[0.07] transition-all duration-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-slate-500 dark:text-zinc-300 uppercase tracking-wider">
                          Your Email
                        </label>
                        <input
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => {
                            // Strip spaces — they are never valid in an email address
                            setEmail(e.target.value.replace(/\s/g, ''));
                            setError('');
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val) {
                              const err = validateEmail(val);
                              if (err) setError(err);
                            }
                          }}
                          placeholder="you@email.com"
                          className="w-full bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.10] rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-violet-400 dark:focus:border-violet-500/50 focus:bg-white dark:focus:bg-white/[0.07] transition-all duration-200"
                        />
                      </div>
                    </div>

                    {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-medium text-sm text-white transition-all duration-200 disabled:opacity-50 hover:shadow-[0_0_24px_rgba(139,92,246,0.40)] active:scale-[0.99]"
                      style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
                    >
                      {submitting ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Setting up…
                        </>
                      ) : 'Begin Interview →'}
                    </button>

                    <div className="pt-1 border-t border-slate-200 dark:border-white/[0.07] space-y-1.5">
                      <p className="text-[11px] text-slate-400 dark:text-zinc-400 text-center">Your details are only used for this screening.</p>
                      <p className="text-[11px] text-center text-slate-400 dark:text-zinc-300">
                        <span className="font-semibold text-slate-600 dark:text-zinc-300">200+</span> tutors have gone through Nova.
                      </p>
                    </div>
                  </form>
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────────────── */}
        <section className="border-t border-slate-200 dark:border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-3">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">How it works</h2>
                <p className="text-slate-500 dark:text-zinc-300 text-sm leading-relaxed max-w-sm">No installation. No account. Just a browser and a microphone.</p>
              </div>
              <ol className="space-y-6">
                {[
                  { step: '1', title: 'Test your microphone',       body: 'One click. We confirm your audio is working before you start.' },
                  { step: '2', title: 'Enter your name and email',  body: 'That is all we need. 30 seconds.' },
                  { step: '3', title: 'Have a real conversation',   body: '4 to 6 questions. Speak naturally. No trick questions — just honest responses.' },
                ].map((item) => (
                  <li key={item.step} className="flex gap-5">
                    <span className="w-6 h-6 rounded-full border border-slate-300 dark:border-white/[0.12] text-[11px] font-bold text-slate-400 dark:text-zinc-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {item.step}
                    </span>
                    <div className="space-y-0.5 pt-0.5">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-300 leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── What we look for ───────────────────────────────────────────────── */}
        <section className="border-t border-slate-200 dark:border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">What we look for</h2>
                <p className="text-slate-500 dark:text-zinc-200 text-sm leading-relaxed">We are not testing your knowledge of mathematics. What is harder to find — and what we actually screen for — is this:</p>
                <p className="text-xs text-slate-400 dark:text-zinc-400 leading-relaxed border-l border-slate-200 dark:border-white/[0.08] pl-3">
                  English fluency is evaluated for clarity, not accent. A strong teacher with an accent will always outrank a fluent speaker who cannot explain things simply.
                </p>
              </div>
              <ul className="space-y-5">
                {SKILLS.map((s) => (
                  <li key={s.name} className="flex gap-4 items-start">
                    <span className="w-1 h-1 rounded-full bg-violet-500 mt-2.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-300">{s.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Waitlist ───────────────────────────────────────────────────────── */}
        <section className="border-t border-slate-200 dark:border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Not ready yet?</h2>
                <p className="text-slate-500 dark:text-zinc-200 text-sm leading-relaxed">We open new tutor cohorts in batches. Leave your email and we will reach out when the next round opens. No spam.</p>
              </div>
              <div>
                {waitlistSubmitted ? (
                  <div className="flex items-start gap-3 border border-slate-200 dark:border-white/[0.10] rounded-lg px-5 py-4 bg-slate-50 dark:bg-white/[0.03]">
                    <svg className="w-4 h-4 text-emerald-500 dark:text-emerald-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="text-sm text-slate-900 dark:text-white font-medium">You're on the list.</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-300 mt-0.5">We'll reach out when the next cohort opens.</p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleWaitlist} noValidate className="space-y-3">
                    <input
                      type="email"
                      value={waitlistEmail}
                      onChange={(e) => { setWaitlistEmail(e.target.value); setWaitlistError(''); }}
                      placeholder="your@email.com"
                      className="w-full bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.10] rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-violet-400 dark:focus:border-violet-500/50 transition-all duration-200"
                    />
                    {waitlistError && <p className="text-xs text-red-500 dark:text-red-400">{waitlistError}</p>}
                    <button
                      type="submit"
                      className="w-full border border-slate-300 dark:border-white/[0.12] text-slate-700 dark:text-white text-sm font-medium py-3 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:border-slate-400 dark:hover:border-white/20 transition-all duration-200"
                    >
                      Join the waitlist
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <footer className="border-t border-slate-200 dark:border-white/[0.06] px-6 py-5">
          <p className="text-center text-slate-500 dark:text-zinc-500 text-xs">
            © {new Date().getFullYear()} Nova — AI Interview Platform
          </p>
        </footer>

      </main>
    </div>
  );
}
