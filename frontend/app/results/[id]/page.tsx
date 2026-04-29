'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface DimensionResult {
  score:    number;
  weight:   number;
  quote:    string;
  feedback: string;
}

interface CandidateResults {
  candidate_id:  string;
  name:          string;
  email:         string;
  overall_score: number;
  passed:        boolean;
  completed_at:  string;
  scores: {
    overall_score: number;
    passed:        boolean;
    dimensions: {
      clarity:      DimensionResult;
      warmth:       DimensionResult;
      patience:     DimensionResult;
      adaptability: DimensionResult;
      fluency:      DimensionResult;
    };
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const DIMENSION_META: Record<string, { name: string; description: string }> = {
  clarity:      { name: 'Communication Clarity', description: 'Explaining simply to a child' },
  warmth:       { name: 'Warmth & Empathy',       description: "Responding to a child's emotions" },
  patience:     { name: 'Patience & Composure',   description: 'Handling frustration calmly' },
  adaptability: { name: 'Adaptability',            description: 'Changing approach when needed' },
  fluency:      { name: 'English Fluency',         description: 'Natural, clear spoken English' },
};

const DIM_ORDER = ['clarity', 'warmth', 'patience', 'adaptability', 'fluency'] as const;

function scoreColor(s: number) {
  return s >= 4 ? '#10B981' : s >= 3 ? '#F59E0B' : '#EF4444';
}

function ScoreBar({ score }: { score: number }) {
  const pct   = (score / 5) * 100;
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-0.5 rounded-full overflow-hidden bg-white/[0.08]">
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

export default function ResultsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data,         setData]         = useState<CandidateResults | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [retries,      setRetries]      = useState(0);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const MAX_RETRIES = 5;

  const downloadPdf = async (d: CandidateResults) => {
    setPdfGenerating(true);
    try {
      const { jsPDF }       = await import('jspdf');
      const autoTableModule = await import('jspdf-autotable');
      const autoTable       = autoTableModule.default;

      const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(91, 33, 182);
      doc.text('NOVA | AI TUTOR SCREENING REPORT', pageW / 2, 18, { align: 'center' });
      doc.setDrawColor(200, 200, 200);
      doc.line(20, 23, pageW - 20, 23);

      let y = 33;
      const label = (txt: string, val: string) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
        doc.text(txt, 20, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
        doc.text(val, 58, y); y += 7;
      };
      label('Full Name:', d.name);
      label('Email:', d.email);
      label('Reference ID:', d.candidate_id);
      label('Date:', new Date(d.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

      y += 4;
      doc.setDrawColor(220, 220, 220); doc.line(20, y, pageW - 20, y); y += 10;
      const verdictRGB: [number, number, number] = d.passed ? [16, 185, 129] : [239, 68, 68];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...verdictRGB);
      doc.text(d.passed ? 'PASS' : 'FAIL', pageW / 2, y, { align: 'center' });
      y += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 100, 100);
      doc.text(`Overall Score: ${d.overall_score.toFixed(1)} / 5.0`, pageW / 2, y, { align: 'center' });

      y += 10;
      autoTable(doc, {
        startY: y,
        head: [['Skill', 'Rating', 'Weight', 'Feedback']],
        body: DIM_ORDER.map((key) => {
          const dim  = d.scores?.dimensions?.[key];
          const meta = DIMENSION_META[key];
          return [meta.name, dim ? `${dim.score} / 5` : '—', `${Math.round((dim?.weight ?? 0) * 100)}%`, dim?.feedback ?? ''];
        }),
        headStyles:         { fillColor: [91, 33, 182], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles:         { fontSize: 8, textColor: [40, 40, 40] },
        columnStyles:       { 0: { cellWidth: 48 }, 1: { cellWidth: 20 }, 2: { cellWidth: 18 }, 3: { cellWidth: 94 } },
        alternateRowStyles: { fillColor: [248, 245, 255] },
      });

      const ts = new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(160, 160, 160);
      doc.text(`Generated by Nova AI  |  ${ts}`, pageW / 2, 287, { align: 'center' });
      doc.save(`nova-report-${d.candidate_id}.pdf`);
    } catch { /* silent */ } finally {
      setPdfGenerating(false);
    }
  };

  // Fetch with retry — backend writes to DB before sending interview_results,
  // but a brief DB round-trip lag can cause a 404 on the very first request.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/results/${params.id}`)
      .then((r) => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then((json: CandidateResults) => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch(() => {
        if (cancelled) return;
        if (retries < MAX_RETRIES) {
          setTimeout(() => { if (!cancelled) setRetries((n) => n + 1); }, 2500);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [params.id, retries]);

  // Auto-download PDF when results first load
  useEffect(() => {
    if (data) downloadPdf(data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center gap-4">
        <div className="w-6 h-6 rounded-full border border-violet-500/40 border-t-violet-500 animate-spin" />
        {retries > 0 && (
          <p className="text-zinc-600 text-xs">
            {retries < MAX_RETRIES ? 'Loading your results…' : 'Almost there…'}
          </p>
        )}
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-screen bg-[#09090B] flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="text-zinc-500 text-sm">Results not found or still processing.</p>
          <button
            onClick={() => router.push('/')}
            className="text-xs text-zinc-700 underline hover:text-zinc-500 transition-colors"
          >
            Return to home
          </button>
        </div>
      </main>
    );
  }

  const { passed, overall_score, name, email, candidate_id, completed_at, scores } = data!;
  const dims = scores?.dimensions;

  // ── Unified results view (pass + fail) ──────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#09090B] px-6 py-14">
      <div className="max-w-xl mx-auto space-y-6 animate-fade-in">

        {/* Verdict banner */}
        <div
          className="rounded-xl px-6 py-5 flex items-center gap-4"
          style={passed
            ? { background: 'rgba(16,185,129,0.07)',  border: '1px solid rgba(16,185,129,0.32)' }
            : { background: 'rgba(239,68,68,0.07)',   border: '1px solid rgba(239,68,68,0.30)'  }
          }
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={passed
              ? { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.40)' }
              : { background: 'rgba(239,68,68,0.10)',  border: '1px solid rgba(239,68,68,0.35)'  }
            }
          >
            {passed ? (
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-lg font-bold text-white">
                {passed ? 'You passed!' : 'Not selected at this stage'}
              </p>
              <span
                className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded"
                style={passed
                  ? { background: 'rgba(16,185,129,0.15)',  color: '#10B981' }
                  : { background: 'rgba(239,68,68,0.12)',   color: '#F87171' }
                }
              >
                {passed ? 'PASS' : 'FAIL'}
              </span>
            </div>
            <p className="text-sm mt-0.5" style={{ color: passed ? '#10B981' : '#F87171' }}>
              Overall score: {overall_score.toFixed(1)} / 5.0
            </p>
          </div>
        </div>

        {/* Candidate info card */}
        <div className="rounded-xl px-5 py-4 bg-white/[0.03] border border-white/[0.07] space-y-1.5">
          <p className="text-sm text-white font-medium">{name}</p>
          <p className="text-xs text-zinc-500">{email}</p>
          <p className="text-[11px] text-zinc-700 font-mono">Ref: {candidate_id}</p>
        </div>

        {/* Context message */}
        <div className="rounded-xl px-5 py-4 bg-white/[0.03] border border-white/[0.07]">
          {passed ? (
            <p className="text-sm text-zinc-300 leading-relaxed">
              You passed the screening. We'll reach out via email with next steps shortly.
            </p>
          ) : (
            <p className="text-sm text-zinc-400 leading-relaxed">
              Thank you for completing the interview, {name.split(' ')[0]}. We appreciate your time and encourage you to apply again in the future.
            </p>
          )}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
            <p className="text-xs text-zinc-600">Your report was downloaded automatically.</p>
            <button
              onClick={() => downloadPdf(data!)}
              disabled={pdfGenerating}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-white/[0.10] text-zinc-300 hover:text-white hover:border-white/[0.20] transition-all duration-150 disabled:opacity-40"
            >
              {pdfGenerating ? (
                <>
                  <div className="w-3 h-3 rounded-full border border-zinc-500/40 border-t-zinc-300 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        {/* Score breakdown */}
        {dims && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Score Breakdown</h2>

            {DIM_ORDER.map((key) => {
              const dim  = dims[key];
              const meta = DIMENSION_META[key];
              if (!dim) return null;
              return (
                <div
                  key={key}
                  className="rounded-xl px-5 py-4 space-y-3 bg-white/[0.03] border border-white/[0.07]"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{meta.name}</p>
                    <p className="text-xs text-zinc-600">{meta.description}</p>
                  </div>

                  <ScoreBar score={dim.score} />

                  {dim.quote && dim.quote !== 'No clear evidence provided.' && (
                    <div className="rounded-lg px-3.5 py-2.5 bg-white/[0.03] border border-white/[0.05]">
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
        )}

        {/* Footer */}
        <div className="text-center pt-2 pb-6">
          <button
            onClick={() => router.push('/')}
            className="text-xs text-zinc-700 underline hover:text-zinc-500 transition-colors"
          >
            Return to home
          </button>
        </div>

      </div>
    </main>
  );
}
