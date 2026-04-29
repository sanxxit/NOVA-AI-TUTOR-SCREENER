'use client';

import { useEffect, useState, FormEvent, useRef } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function validateEmail(email: string): string | null {
  if (email.length > 254) return 'Email must be 254 characters or fewer.';
  if (/\s/.test(email))   return 'Email must not contain spaces.';
  const atMatches = email.match(/@/g);
  if (!atMatches)             return 'Email must contain "@".';
  if (atMatches.length > 1)   return 'Email must contain exactly one "@".';
  const [localPart, domain] = email.split('@');
  if (!localPart)                          return 'Email local part must not be empty.';
  if (localPart.length > 64)               return 'Email local part must be 64 characters or fewer.';
  if (!/^[A-Za-z0-9._%+\-]+$/.test(localPart)) return 'Email contains invalid characters before "@".';
  if (localPart.startsWith('.'))           return 'Local part must not start with ".".';
  if (localPart.endsWith('.'))             return 'Local part must not end with ".".';
  if (localPart.includes('..'))            return 'Local part must not contain consecutive dots.';
  if (!domain)                  return 'Email domain must not be empty.';
  if (domain.length > 255)      return 'Email domain must be 255 characters or fewer.';
  if (!domain.includes('.'))    return 'Email domain must contain at least one ".".';
  if (domain.includes('..'))    return 'Email domain must not contain consecutive dots.';
  const labels = domain.split('.');
  for (const label of labels) {
    if (!label)                          return 'Email domain must not have empty labels.';
    if (!/^[A-Za-z0-9-]+$/.test(label)) return 'Email domain contains invalid characters.';
    if (label.startsWith('-'))           return 'Domain labels must not start with "-".';
    if (label.endsWith('-'))             return 'Domain labels must not end with "-".';
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]+$/.test(tld)) return 'TLD must contain only letters.';
  if (tld.length < 2)            return 'TLD must be at least 2 characters.';
  return null;
}

type TokenStatus = 'loading' | 'valid' | 'invalid' | 'used';

export default function ApplyPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('loading');
  const [inviteNote,  setInviteNote]  = useState('');
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [error,       setError]       = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/invite/${params.token}`)
      .then((r) => {
        if (r.status === 404) { setTokenStatus('invalid'); return null; }
        if (r.status === 410) { setTokenStatus('used');    return null; }
        if (!r.ok) { setTokenStatus('invalid'); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setInviteNote(data.note || '');
          setTokenStatus('valid');
          setTimeout(() => nameInputRef.current?.focus(), 100);
        }
      })
      .catch(() => setTokenStatus('invalid'));
  }, [params.token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedName  = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) { setError('Please enter your name.'); nameInputRef.current?.focus(); return; }
    const emailError = validateEmail(trimmedEmail);
    if (emailError) { setError(emailError); return; }

    setSubmitting(true);

    // Check if email already completed
    try {
      const res = await fetch(`${API_URL}/api/check-email?email=${encodeURIComponent(trimmedEmail)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.completed && data.candidate_id) {
          router.push(`/results/${data.candidate_id}`);
          return;
        }
      }
    } catch { /* proceed */ }

    const candidateId = crypto.randomUUID();
    localStorage.setItem(
      'candidate_session',
      JSON.stringify({ candidate_id: candidateId, name: trimmedName, email: trimmedEmail, invite_token: params.token }),
    );
    window.dispatchEvent(new Event('candidateSessionUpdated'));
    router.push('/onboarding');
  };

  return (
    <main className="min-h-screen bg-[#09090B] text-white flex flex-col items-center justify-center px-6 py-16">

      {/* Brand */}
      <div className="mb-10 text-center">
        <div className="text-5xl font-black text-white tracking-tight">NOVA</div>
        <p className="text-[11px] font-semibold text-violet-400 uppercase tracking-[0.18em] mt-1">AI Interview Platform</p>
      </div>

      {tokenStatus === 'loading' && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
          <span className="text-zinc-600 text-sm">Validating invite link…</span>
        </div>
      )}

      {tokenStatus === 'invalid' && (
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-lg font-bold text-white">Invalid invite link.</p>
          <p className="text-zinc-500 text-sm">This link doesn't exist or has expired. Ask the recruiter for a new one.</p>
        </div>
      )}

      {tokenStatus === 'used' && (
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)' }}>
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-lg font-bold text-white">This link has already been used.</p>
          <p className="text-zinc-500 text-sm">Each invite link is single-use. Contact the recruiter if you need a new one.</p>
        </div>
      )}

      {tokenStatus === 'valid' && (
        <div
          className="max-w-sm w-full rounded-2xl p-8 space-y-6"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-white">You&apos;ve been invited to interview.</h1>
            {inviteNote && (
              <p className="text-sm text-violet-400">{inviteNote}</p>
            )}
            <p className="text-zinc-500 text-sm leading-relaxed">
              Fill in your details below. The interview takes about 10 minutes — voice only, no camera needed.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Your Name</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(''); }}
                  placeholder="e.g. Priya Sharma"
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Your Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value.replace(/\s/g, '')); setError(''); }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) { const err = validateEmail(v); if (err) setError(err); } }}
                  placeholder="you@email.com"
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 transition-all"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-medium text-sm text-white transition-all duration-200 disabled:opacity-50 hover:shadow-[0_0_24px_rgba(139,92,246,0.40)]"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Setting up…
                </>
              ) : 'Begin Interview →'}
            </button>
          </form>

          <p className="text-[11px] text-zinc-600 text-center">
            Your details are only used for this screening. Nothing is recorded until the interview begins.
          </p>
        </div>
      )}

    </main>
  );
}
