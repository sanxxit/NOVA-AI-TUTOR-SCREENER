'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimData {
  score:             number;
  weight:            number;
  quote:             string;
  feedback:          string;
  observed_behavior?: string;
  positive_signals?:  string[];
  negative_signals?:  string[];
  rubric_anchor?:     string;
}

interface Scores {
  overall_score: number;
  passed:        boolean;
  dimensions:    Record<string, DimData>;
}

interface Candidate {
  candidate_id: string;
  name:         string;
  email:        string;
  overall_score: number;
  passed:        boolean;
  completed_at:  string;
  created_at:    string;
  unlocked?:     number;
  scores:        Scores;
  transcript:    { role: string; content: string }[];
}

type FilterType = 'all' | 'pass' | 'fail';
type SortKey    = 'recent' | 'score-desc' | 'score-asc';

// ─── Constants ────────────────────────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  clarity:      'Communication Clarity',
  warmth:       'Warmth & Empathy',
  patience:     'Patience & Composure',
  adaptability: 'Adaptability',
  fluency:      'English Fluency',
};
const DIM_ORDER = ['clarity', 'warmth', 'patience', 'adaptability', 'fluency'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  return s >= 4 ? '#10B981' : s >= 3 ? '#F59E0B' : '#EF4444';
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function downloadCSV(candidates: Candidate[]) {
  const headers = ['ID', 'Name', 'Email', 'Score', 'Result', 'Completed', 'Clarity', 'Warmth', 'Patience', 'Adaptability', 'Fluency'];
  const rows = candidates.map((c) => {
    const dims = c.scores?.dimensions ?? {};
    return [
      c.candidate_id,
      `"${c.name.replace(/"/g, '""')}"`,
      c.email,
      c.overall_score.toFixed(2),
      c.passed ? 'PASS' : 'FAIL',
      `"${formatDate(c.completed_at)}"`,
      dims.clarity?.score?.toFixed(1)      ?? '',
      dims.warmth?.score?.toFixed(1)       ?? '',
      dims.patience?.score?.toFixed(1)     ?? '',
      dims.adaptability?.score?.toFixed(1) ?? '',
      dims.fluency?.score?.toFixed(1)      ?? '',
    ].join(',');
  });
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MiniScoreBar({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-2.5 min-w-[100px]">
      <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(score / 5) * 100}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}50` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums w-7" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Sparkline heatmap — 5 dots, one per dimension ───────────────────────────

const DIM_DOT_KEYS = ['clarity', 'warmth', 'patience', 'adaptability', 'fluency'] as const;

function ScoreDots({ dims }: { dims: Record<string, DimData> }) {
  return (
    <div className="flex items-center gap-1.5">
      {DIM_DOT_KEYS.map((key) => {
        const score = dims[key]?.score;
        if (score === undefined) {
          return <div key={key} className="w-2.5 h-2.5 rounded-full" style={{ background: '#27272A' }} />;
        }
        const color = score >= 4 ? '#10B981' : score >= 3 ? '#F59E0B' : '#EF4444';
        const glow  = score >= 4 ? 'rgba(16,185,129,0.55)' : score >= 3 ? 'rgba(245,158,11,0.55)' : 'rgba(239,68,68,0.55)';
        return (
          <div key={key} className="relative group/dot">
            <div
              className="w-2.5 h-2.5 rounded-full cursor-default"
              style={{ backgroundColor: color, boxShadow: `0 0 6px ${glow}` }}
            />
            {/* Tooltip */}
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded pointer-events-none z-20 whitespace-nowrap opacity-0 group-hover/dot:opacity-100 transition-opacity duration-150"
              style={{ background: '#18181B', border: '1px solid #27272A', color: '#E4E4E7', fontSize: '10px' }}
            >
              <span className="text-zinc-500">{DIM_LABELS[key]}</span>
              <span className="ml-1.5 font-semibold" style={{ color }}>{score.toFixed(1)}</span>
              {/* Arrow */}
              <div
                className="absolute top-full left-1/2 -translate-x-1/2"
                style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '4px solid #27272A' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PassBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
      style={passed
        ? { background: 'rgba(16,185,129,0.10)', color: '#10B981', border: '1px solid rgba(16,185,129,0.40)' }
        : { background: 'rgba(239,68,68,0.10)',  color: '#EF4444', border: '1px solid rgba(239,68,68,0.40)' }
      }
    >
      {passed ? 'PASS' : 'FAIL'}
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div
        className="relative rounded-xl border border-zinc-800 w-full max-w-2xl max-h-[80vh] flex flex-col"
        style={{ background: '#0A0A0A' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-300 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Conversation modal body ──────────────────────────────────────────────────

function ConversationView({ candidate }: { candidate: Candidate }) {
  const transcript = candidate.transcript ?? [];
  if (transcript.length === 0) {
    return <p className="text-zinc-300 text-sm text-center py-10">No transcript available.</p>;
  }
  return (
    <div className="space-y-3">
      {transcript.map((turn, i) => {
        const isAI = turn.role === 'assistant';
        return (
          <div key={i} className={`flex gap-3 ${isAI ? '' : 'flex-row-reverse'}`}>
            <div
              className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
              style={{ background: isAI ? 'rgba(139,92,246,0.40)' : 'rgba(59,130,246,0.40)', border: `1px solid ${isAI ? 'rgba(139,92,246,0.50)' : 'rgba(59,130,246,0.50)'}` }}
            >
              {isAI ? 'N' : 'C'}
            </div>
            <div className={`max-w-[80%] space-y-0.5 ${isAI ? '' : 'items-end flex flex-col'}`}>
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                {isAI ? 'Nova' : 'Candidate'}
              </span>
              <div
                className="px-3 py-2 rounded-lg text-xs leading-relaxed text-zinc-300"
                style={{
                  background: isAI ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.05)',
                  border:     '1px solid rgba(255,255,255,0.07)',
                }}
              >
                {turn.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI Reasoning modal body ──────────────────────────────────────────────────

function ReasoningView({ candidate }: { candidate: Candidate }) {
  const scores = candidate.scores;
  if (!scores) {
    return <p className="text-zinc-300 text-sm text-center py-10">No assessment data available.</p>;
  }
  const dims = scores.dimensions ?? {};
  return (
    <div className="space-y-5">
      {/* Verdict */}
      <div
        className="rounded-lg p-4"
        style={{
          background: scores.passed ? 'rgba(16,185,129,0.06)'  : 'rgba(239,68,68,0.06)',
          border:     `1px solid ${scores.passed ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
        }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white">
              {scores.passed ? 'Candidate Passed Screening' : 'Candidate Did Not Pass'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Weighted score: <strong className="text-white">{scores.overall_score.toFixed(2)} / 5.0</strong> — Pass threshold is 3.0.
            </p>
          </div>
          <PassBadge passed={scores.passed} />
        </div>
      </div>

      {/* Formula */}
      <div className="rounded-lg p-4 border border-zinc-800" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <p className="text-xs font-semibold text-white mb-1">How the score is calculated</p>
        <p className="text-xs text-zinc-300 leading-relaxed">
          Nova evaluated 5 dimensions from the conversation. Each is scored 1–5 and weighted by importance. The final score is the weighted average. A score ≥ 3.0 results in a PASS.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DIM_ORDER.map((key) => {
            const dim = dims[key];
            if (!dim) return null;
            return (
              <span key={key} className="text-[10px] px-2 py-0.5 rounded border border-zinc-800 text-zinc-300">
                {DIM_LABELS[key]} · {Math.round(dim.weight * 100)}%
              </span>
            );
          })}
        </div>
      </div>

      {/* Per-dimension */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Dimension-by-Dimension</p>
        {DIM_ORDER.map((key) => {
          const dim = dims[key];
          if (!dim) return null;
          return (
            <div key={key} className="rounded-lg border border-zinc-800 p-4 space-y-2.5" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{DIM_LABELS[key]}</span>
                  <span className="text-[10px] text-zinc-400">({Math.round(dim.weight * 100)}%)</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-20 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(dim.score / 5) * 100}%`, backgroundColor: scoreColor(dim.score) }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor(dim.score) }}>{dim.score} / 5</span>
                </div>
              </div>
              {dim.quote && dim.quote !== 'No clear evidence provided.' && (
                <div className="rounded-md px-3 py-2 border border-zinc-800/60" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-medium mb-1">Evidence</p>
                  <p className="text-xs text-zinc-500 italic leading-relaxed">"{dim.quote}"</p>
                </div>
              )}
              {dim.feedback && (
                <div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-medium mb-1">Assessment</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{dim.feedback}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dimension cards (expanded row) ──────────────────────────────────────────

function DimCard({ dimKey, dim }: { dimKey: string; dim: DimData }) {
  return (
    <div className="rounded-lg border border-zinc-900 p-4 space-y-3" style={{ background: '#000' }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-white leading-tight">{DIM_LABELS[dimKey] ?? dimKey}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(255,255,255,0.05)', color: '#D4D4D8' }}>
          {Math.round(dim.weight * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(dim.score / 5) * 100}%`, backgroundColor: scoreColor(dim.score), boxShadow: `0 0 8px ${scoreColor(dim.score)}60` }} />
        </div>
        <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor(dim.score) }}>{dim.score} / 5</span>
      </div>
      {dim.observed_behavior && (
        <p className="text-xs text-zinc-300 leading-relaxed">{dim.observed_behavior}</p>
      )}
      {dim.positive_signals && dim.positive_signals.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#10B981' }}>Strengths</p>
          <ul className="space-y-1">
            {dim.positive_signals.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-500 leading-relaxed">
                <span className="flex-shrink-0 font-bold" style={{ color: '#059669' }}>+</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dim.negative_signals && dim.negative_signals.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#EF4444' }}>Areas to Improve</p>
          <ul className="space-y-1">
            {dim.negative_signals.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-500 leading-relaxed">
                <span className="flex-shrink-0 font-bold" style={{ color: '#DC2626' }}>−</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!dim.positive_signals && !dim.negative_signals && dim.quote && dim.quote !== 'No clear evidence provided.' && (
        <div className="rounded-md px-3 py-2 border border-zinc-900" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <p className="text-xs text-zinc-300 italic leading-relaxed">"{dim.quote}"</p>
        </div>
      )}
      {dim.rubric_anchor && (
        <p className="text-[10px] text-zinc-400 leading-relaxed border-t border-zinc-900 pt-2">{dim.rubric_anchor}</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter,     setFilter]     = useState<FilterType>('all');
  const [sortKey,    setSortKey]    = useState<SortKey>('recent');
  const [conversationFor, setConversationFor] = useState<Candidate | null>(null);
  const [reasoningFor,    setReasoningFor]    = useState<Candidate | null>(null);

  // Unlock state
  const [unlockingEmail, setUnlockingEmail] = useState<string | null>(null);
  const [unlockMsg,      setUnlockMsg]      = useState('');
  const [unlockedEmails, setUnlockedEmails] = useState<Set<string>>(new Set());

  // Invite state
  const [showInviteModal,  setShowInviteModal]  = useState(false);
  const [inviteNote,       setInviteNote]       = useState('');
  const [generatedLink,    setGeneratedLink]    = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied,           setCopied]           = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) { router.replace('/admin/login'); return; }
    fetch(`${API_BASE}/api/admin/candidates`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) { sessionStorage.removeItem('admin_token'); router.replace('/admin/login'); return null; }
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => { if (data) { setCandidates(data); setLoading(false); } })
      .catch((err) => { setError(`Could not load data — ${err.message}`); setLoading(false); });
  }, [router]);

  useEffect(() => {
    if (!unlockMsg) return;
    const t = setTimeout(() => setUnlockMsg(''), 3000);
    return () => clearTimeout(t);
  }, [unlockMsg]);

  const handleUnlock = async (email: string) => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) return;
    setUnlockingEmail(email);
    setUnlockMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Failed');
      setUnlockedEmails((prev) => new Set(prev).add(email));
      setUnlockMsg(`${email} unlocked for one re-attempt.`);
    } catch {
      setUnlockMsg(`Failed to unlock ${email}.`);
    } finally {
      setUnlockingEmail(null);
    }
  };

  const handleGenerateInvite = async () => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) return;
    setGeneratingInvite(true);
    setGeneratedLink('');
    setCopied(false);
    try {
      const res = await fetch(`${API_BASE}/api/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note: inviteNote }),
      });
      const data = await res.json();
      setGeneratedLink(`${window.location.origin}/apply/${data.token}`);
    } finally {
      setGeneratingInvite(false);
    }
  };

  const filtered = candidates.filter((c) => filter === 'all' ? true : filter === 'pass' ? c.passed : !c.passed);
  const sorted   = [...filtered].sort((a, b) => {
    if (sortKey === 'score-desc') {
      if (b.overall_score !== a.overall_score) return b.overall_score - a.overall_score;
      return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime();
    }
    if (sortKey === 'score-asc') return a.overall_score - b.overall_score;
    return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime();
  });
  const passCount = candidates.filter((c) => c.passed).length;
  const failCount = candidates.length - passCount;
  const avgScore  = candidates.length
    ? (candidates.reduce((s, c) => s + c.overall_score, 0) / candidates.length).toFixed(2)
    : null;

  const toggle = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-6 pt-20 pb-10">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Home
              </button>
              <span className="text-zinc-500">·</span>
              <button
                onClick={() => { sessionStorage.removeItem('admin_token'); router.replace('/admin/login'); }}
                className="text-xs text-zinc-400 hover:text-zinc-400 transition-colors"
              >
                Sign out
              </button>
            </div>
            <h1 className="text-3xl font-bold text-white">Candidate Dashboard</h1>
            <p className="text-zinc-300 text-sm">
              {loading ? 'Loading…' : `${candidates.length} completed assessment${candidates.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {!loading && candidates.length > 0 && (
            <div className="flex gap-3 flex-wrap items-start">
              {[
                { label: 'Total',     value: candidates.length.toString() },
                { label: 'Passed',    value: `${passCount} (${Math.round((passCount / candidates.length) * 100)}%)` },
                { label: 'Avg Score', value: `${avgScore} / 5.0` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-zinc-800 px-4 py-3 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <p className="text-[11px] text-zinc-300">{label}</p>
                  <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
                </div>
              ))}

              <button
                onClick={() => downloadCSV(sorted)}
                className="flex items-center gap-2 text-xs font-medium px-4 py-3 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all duration-150"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download CSV
              </button>

              <button
                onClick={() => { setShowInviteModal(true); setGeneratedLink(''); setInviteNote(''); setCopied(false); }}
                className="flex items-center gap-2 text-xs font-medium px-4 py-3 rounded-lg border transition-all duration-150"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.30)', color: '#A78BFA' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Generate Invite Link
              </button>
            </div>
          )}
        </div>

        <div className="h-px bg-zinc-900" />

        {/* Filter + Sort bar */}
        {!loading && candidates.length > 0 && (
          <div className="flex items-center justify-between gap-4 flex-wrap">

            {/* Filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-600 font-medium">Filter:</span>
              {([
                { key: 'all',  label: `All (${candidates.length})` },
                { key: 'pass', label: `Selected (${passCount})` },
                { key: 'fail', label: `Not Selected (${failCount})` },
              ] as { key: FilterType; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="text-xs px-3 py-1.5 rounded-md border transition-all duration-150 font-medium"
                  style={{
                    background:  filter === key ? 'rgba(139,92,246,0.15)' : 'transparent',
                    color:       filter === key ? '#A78BFA' : '#71717A',
                    borderColor: filter === key ? 'rgba(139,92,246,0.40)' : '#27272A',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Sort segmented control */}
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-zinc-600 font-medium">Sort:</span>
              <div
                className="flex items-center rounded-lg p-0.5 gap-0.5"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {([
                  {
                    key:   'score-desc' as SortKey,
                    label: 'High → Low',
                    icon:  (
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4 4m0 0l4-4m-4 4V4" />
                      </svg>
                    ),
                  },
                  {
                    key:   'score-asc' as SortKey,
                    label: 'Low → High',
                    icon:  (
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
                      </svg>
                    ),
                  },
                  {
                    key:   'recent' as SortKey,
                    label: 'Recent',
                    icon:  (
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ),
                  },
                ]).map(({ key, label, icon }) => {
                  const active = sortKey === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSortKey(key)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 whitespace-nowrap"
                      style={{
                        background: active
                          ? 'linear-gradient(135deg, rgba(124,58,237,0.40) 0%, rgba(168,85,247,0.30) 100%)'
                          : 'transparent',
                        color:       active ? '#C4B5FD' : '#52525B',
                        border:      active ? '1px solid rgba(139,92,246,0.35)' : '1px solid transparent',
                        boxShadow:   active ? '0 0 10px rgba(139,92,246,0.20)' : 'none',
                      }}
                    >
                      {icon}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="w-6 h-6 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
            <p className="text-zinc-300 text-sm">Loading candidates…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-lg border border-red-500/20 p-6 text-center space-y-2" style={{ background: 'rgba(239,68,68,0.05)' }}>
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => window.location.reload()} className="text-xs text-zinc-300 underline">Try again</button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && candidates.length === 0 && (
          <div className="rounded-lg border border-zinc-800 p-14 text-center space-y-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-lg font-semibold text-white">No results yet.</p>
            <p className="text-zinc-300 text-sm">Results will appear here once candidates complete their assessments.</p>
          </div>
        )}

        {!loading && !error && candidates.length > 0 && sorted.length === 0 && (
          <div className="rounded-lg border border-zinc-800 p-8 text-center">
            <p className="text-zinc-300 text-sm">No candidates match this filter.</p>
          </div>
        )}

        {/* Table */}
        {!loading && !error && sorted.length > 0 && (
          <div className="rounded-xl border border-zinc-900 overflow-hidden" style={{ background: '#000' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-900" style={{ background: '#000' }}>
                    {['Unique ID', 'Name', 'Email', 'Score', 'Result', 'Completed', 'Conversation', 'AI Reasoning', 'Actions', ''].map((h) => (
                      <th
                        key={h}
                        className="py-3 px-4 text-left text-[11px] font-medium text-zinc-400 tracking-[0.07em] uppercase whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => {
                    const isOpen = expandedId === c.candidate_id;
                    return (
                      <>
                        <tr
                          key={c.candidate_id}
                          className="border-b border-zinc-900 last:border-0 transition-colors duration-100"
                          style={{ background: isOpen ? 'rgba(139,92,246,0.04)' : '#000' }}
                          onMouseEnter={(e) => { if (!isOpen) (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.015)'; }}
                          onMouseLeave={(e) => { if (!isOpen) (e.currentTarget as HTMLTableRowElement).style.background = '#000'; }}
                        >
                          {/* Unique ID */}
                          <td className="py-4 px-4">
                            <span
                              title={c.candidate_id}
                              className="font-mono text-[11px] text-zinc-300 px-2 py-1 rounded cursor-default select-all"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                            >
                              {shortId(c.candidate_id)}
                            </span>
                          </td>

                          {/* Name */}
                          <td className="py-4 px-4 font-medium text-white whitespace-nowrap">{c.name}</td>

                          {/* Email */}
                          <td className="py-4 px-4 text-zinc-300 text-xs">{c.email}</td>

                          {/* Score */}
                          <td className="py-4 px-4">
                            <div className="space-y-1.5">
                              <ScoreDots dims={c.scores?.dimensions ?? {}} />
                              <MiniScoreBar score={c.overall_score} />
                            </div>
                          </td>

                          {/* Result */}
                          <td className="py-4 px-4"><PassBadge passed={c.passed} /></td>

                          {/* Date */}
                          <td className="py-4 px-4 text-zinc-400 text-xs whitespace-nowrap">{formatDate(c.completed_at)}</td>

                          {/* Conversation */}
                          <td className="py-4 px-4">
                            <button
                              onClick={() => setConversationFor(c)}
                              className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-violet-400 transition-colors duration-150 whitespace-nowrap"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Transcript
                            </button>
                          </td>

                          {/* AI Reasoning */}
                          <td className="py-4 px-4">
                            <button
                              onClick={() => setReasoningFor(c)}
                              className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-fuchsia-400 transition-colors duration-150 whitespace-nowrap"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              Why AI Decided
                            </button>
                          </td>

                          {/* Actions — Unlock */}
                          <td className="py-4 px-4">
                            {(() => {
                              const isUnlocking = unlockingEmail === c.email;
                              const isUnlocked  = c.unlocked === 1 || unlockedEmails.has(c.email);

                              if (isUnlocking) return (
                                <button
                                  disabled
                                  className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded border border-amber-500/30 text-amber-400 disabled:opacity-60 whitespace-nowrap font-medium"
                                >
                                  <div className="w-2.5 h-2.5 rounded-full border border-amber-400/40 border-t-amber-400 animate-spin flex-shrink-0" />
                                  Unlocking…
                                </button>
                              );

                              if (isUnlocked) return (
                                <div
                                  className="group/unlock relative flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded whitespace-nowrap font-medium cursor-default"
                                  style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.35)', color: '#34D399' }}
                                >
                                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                  </svg>
                                  Unlocked
                                  {/* Tooltip */}
                                  <div
                                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded pointer-events-none z-20 whitespace-nowrap opacity-0 group-hover/unlock:opacity-100 transition-opacity duration-150 text-[10px]"
                                    style={{ background: '#18181B', border: '1px solid #27272A', color: '#A1A1AA' }}
                                  >
                                    Auto-locks after candidate retakes
                                    <div className="absolute top-full left-1/2 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '4px solid #27272A' }} />
                                  </div>
                                </div>
                              );

                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleUnlock(c.email); }}
                                  className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all duration-150 whitespace-nowrap font-medium"
                                >
                                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                  </svg>
                                  Unlock
                                </button>
                              );
                            })()}
                          </td>

                          {/* Expand */}
                          <td className="py-4 px-4 text-right">
                            <button
                              onClick={() => toggle(c.candidate_id)}
                              className="flex items-center gap-1.5 text-xs font-medium transition-colors duration-150 ml-auto whitespace-nowrap"
                              style={{ color: isOpen ? '#A78BFA' : '#D4D4D8' }}
                            >
                              {isOpen ? 'Close' : 'Dim Scores'}
                              <svg
                                className="w-3.5 h-3.5 transition-transform duration-200"
                                style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </td>
                        </tr>

                        {/* Expanded dimension cards */}
                        {isOpen && (
                          <tr key={`${c.candidate_id}-detail`} className="border-b border-zinc-900 last:border-0">
                            <td colSpan={10} className="p-0">
                              <div className="px-4 py-5" style={{ background: 'rgba(139,92,246,0.025)', borderTop: '1px solid rgba(139,92,246,0.12)' }}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                  {DIM_ORDER.map((key) => {
                                    const dim = c.scores?.dimensions?.[key];
                                    if (!dim) return null;
                                    return <DimCard key={key} dimKey={key} dim={dim} />;
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {conversationFor && (
        <Modal title={`Interview Transcript — ${conversationFor.name}`} onClose={() => setConversationFor(null)}>
          <ConversationView candidate={conversationFor} />
        </Modal>
      )}

      {reasoningFor && (
        <Modal title={`AI Assessment Reasoning — ${reasoningFor.name}`} onClose={() => setReasoningFor(null)}>
          <ReasoningView candidate={reasoningFor} />
        </Modal>
      )}

      {/* Invite Link Modal */}
      {showInviteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowInviteModal(false)}
        >
          <div
            className="flex flex-col gap-5 p-7 rounded-2xl w-full max-w-sm mx-6"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.10)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-white">Generate Invite Link</p>
              <button onClick={() => setShowInviteModal(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Note / Label (optional)</label>
              <input
                type="text"
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value)}
                placeholder="e.g. Batch Jan 2025"
                className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 transition-all"
              />
            </div>
            <button
              onClick={handleGenerateInvite}
              disabled={generatingInvite}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)' }}
            >
              {generatingInvite ? 'Generating…' : 'Generate Link'}
            </button>
            {generatedLink && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Invite Link</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={generatedLink}
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => { navigator.clipboard.writeText(generatedLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150"
                    style={{
                      background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
                      border: copied ? '1px solid rgba(16,185,129,0.30)' : '1px solid rgba(139,92,246,0.30)',
                      color: copied ? '#10B981' : '#A78BFA',
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600">Single-use link — expires after one interview is started.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unlock toast */}
      {unlockMsg && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm text-white pointer-events-none"
          style={{ background: 'rgba(30,30,35,0.97)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
        >
          {unlockMsg}
        </div>
      )}
    </main>
  );
}
