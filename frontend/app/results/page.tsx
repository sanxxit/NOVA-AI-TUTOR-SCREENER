'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface DimensionResult {
  score:    number;
  weight:   number;
  quote:    string;
  feedback: string;
}

interface InterviewResults {
  passed:        boolean;
  overall_score: number;
  dimensions: {
    clarity:      DimensionResult;
    warmth:       DimensionResult;
    patience:     DimensionResult;
    adaptability: DimensionResult;
    fluency:      DimensionResult;
  };
}

const DIMENSION_META: Record<string, { name: string; description: string }> = {
  clarity:      { name: 'Communication Clarity', description: 'Explaining simply to a child' },
  warmth:       { name: 'Warmth & Empathy',       description: "Responding to a child's emotions" },
  patience:     { name: 'Patience & Composure',   description: 'Handling frustration calmly' },
  adaptability: { name: 'Adaptability',            description: 'Changing approach when needed' },
  fluency:      { name: 'English Fluency',         description: 'Natural, clear spoken English' },
};

function scoreColor(s: number) {
  return s >= 4 ? '#10B981' : s >= 3 ? '#F59E0B' : '#EF4444';
}

function ScoreBar({ score }: { score: number }) {
  const pct   = (score / 5) * 100;
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}60` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color, minWidth: '2.5rem' }}>
        {score} / 5
      </span>
    </div>
  );
}

export default function ResultsPage() {
  const router  = useRouter();
  const [results, setResults] = useState<InterviewResults | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('interview_results');
      if (!raw) { router.push('/'); return; }
      setResults(JSON.parse(raw));
    } catch { router.push('/'); }
  }, [router]);

  if (!results) {
    return (
      <main className="min-h-screen bg-[#09090B] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
      </main>
    );
  }

  const { passed, overall_score, dimensions } = results;
  const dimOrder = ['clarity', 'warmth', 'patience', 'adaptability', 'fluency'] as const;

  return (
    <main className="min-h-screen bg-[#09090B] px-6 py-14">
      <div className="max-w-xl mx-auto space-y-8 animate-fade-in">

        {/* Pass / Fail banner */}
        <div
          className="rounded-xl px-6 py-5 flex items-center gap-4"
          style={{
            background: passed ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
            border:     `1px solid ${passed ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: passed ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${passed ? '#10B981' : '#EF4444'}40` }}
          >
            {passed ? (
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-lg font-bold text-white">
              {passed ? "You've Passed" : 'Not Quite Yet'}
            </p>
            <p className="text-sm" style={{ color: passed ? '#10B981' : '#EF4444' }}>
              Overall score: {overall_score.toFixed(1)} / 5.0
            </p>
          </div>
        </div>

        {/* Dimension breakdown */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white">Score Breakdown</h2>

          {dimOrder.map((key) => {
            const dim  = dimensions[key];
            const meta = DIMENSION_META[key];
            return (
              <div
                key={key}
                className="rounded-xl px-5 py-4 space-y-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-medium text-sm">{meta.name}</p>
                    <p className="text-zinc-600 text-xs">{meta.description}</p>
                  </div>
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#71717A' }}
                  >
                    {Math.round(dim.weight * 100)}%
                  </span>
                </div>

                <ScoreBar score={dim.score} />

                {dim.quote && dim.quote !== 'No clear evidence provided.' && (
                  <div className="rounded-lg px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p className="text-xs text-zinc-600 leading-relaxed italic">
                      <span className="not-italic font-medium text-zinc-500">Evidence: </span>
                      "{dim.quote}"
                    </p>
                  </div>
                )}

                {dim.feedback && (
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    <span className="font-medium text-zinc-500">Feedback: </span>
                    {dim.feedback}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="text-center pt-2">
          <button
            onClick={() => { localStorage.removeItem('interview_results'); router.push('/'); }}
            className="text-xs text-zinc-700 underline hover:text-zinc-500 transition-colors"
          >
            Return to home
          </button>
        </div>
      </div>
    </main>
  );
}
