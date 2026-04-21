'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InterviewRedirect() {
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = localStorage.getItem('candidate_session');
      const session = raw ? JSON.parse(raw) : {};
      if (session.candidate_id) {
        router.replace(`/interview/${session.candidate_id}`);
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    }
  }, [router]);

  return null;
}
