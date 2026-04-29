'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function CandidateSessionBadge() {
  const pathname = usePathname();
  const [session, setSession] = useState<{ name?: string; email?: string } | null>(null);

  useEffect(() => {
    const readSession = () => {
      try {
        const raw = localStorage.getItem('candidate_session');
        setSession(raw ? JSON.parse(raw) : null);
      } catch { /* ignore */ }
    };

    readSession();
    window.addEventListener('storage', readSession);
    window.addEventListener('candidateSessionUpdated', readSession);
    return () => {
      window.removeEventListener('storage', readSession);
      window.removeEventListener('candidateSessionUpdated', readSession);
    };
  }, []);

  if (!session?.name || pathname.startsWith('/admin')) return null;

  return (
    <div className="flex flex-col items-end gap-0.5 pointer-events-none select-none">
      <span className="text-xs font-semibold text-slate-900 dark:text-white leading-none">
        {session.name}
      </span>
      {session.email && (
        <span className="text-[10px] text-slate-500 dark:text-zinc-500 leading-none">
          {session.email}
        </span>
      )}
    </div>
  );
}
