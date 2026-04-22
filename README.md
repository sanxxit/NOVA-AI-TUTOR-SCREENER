# NOVA — Autonomous AI Tutor Screener
### Built for the Cuemath Engineering Challenge

**A production-ready, voice-first recruitment engine designed to autonomously screen math tutors at scale, evaluating communication clarity, empathy, and patience before human intervention.**

[![Deploy Status](https://img.shields.io/badge/Vercel-Deployed-success?logo=vercel)](#) [![Backend Status](https://img.shields.io/badge/Render-Live-success?logo=render)](#) [![AI Workflow](https://img.shields.io/badge/Claude_Code-Agentic_Workflow-8B5CF6)](#)

---
## 🧠 The 'Director' Architecture Approach
This platform was not manually typed line-by-line. To achieve enterprise scale at 10x velocity, I acted as the **Director** of an autonomous agentic workflow using Claude Code. 

By engineering a persistent memory state (`donesofar.md`), I orchestrated complex microservices—including a sub-two-second sentence-level streaming pipeline and strict edge-case logic—while the AI executed the implementation. 

**Explore the Architecture:**
* 📄 [Technical Write-up & Tradeoffs](https://docs.google.com/document/d/1hIaMjC5e0-zRDPSjHOM8HC7tlv2Mct00ziIVWwim3-M/edit?usp=drive_web)
* 🧠 [The Agentic Memory State (donesofar.md)](./Done_so_far.md)
* ⚖️ [The 5-Dimension Scoring Rubric](./screener-rubric.md)

---

## How It Works

1. Candidate receives a unique interview link
2. They speak naturally to Maya — no typing, no forms
3. Maya listens, transcribes client-side (Whisper WASM), and responds in real time via TTS
4. After 5–7 questions (~10 minutes), the interview closes
5. Groq scores the transcript across 5 dimensions
6. Candidate sees their results; recruiter gets an email alert

---

## Features

- **Voice-first UX** — microphone → Whisper (in-browser WASM) → WebSocket → Groq LLM → Piper/Sarvam TTS → speaker
- **Adaptive interviewing** — Maya follows up on vague answers, redirects tangents, re-prompts silence
- **5-dimension scoring** — each dimension has a chain-of-thought rubric, quote evidence, and weighted score
- **Real-time waveform** — live canvas animation that tracks listening / thinking / speaking states
- **One-attempt enforcement** — email-level deduplication blocks re-interviews
- **Admin dashboard** — review all completed interviews, transcripts, and scores
- **Email notifications** — candidate congratulations + recruiter alert via Resend (PASS only)
- **PDF report** — auto-downloaded on PASS with scores, verdict, and reference ID
- **Obsidian dark mode** — premium `#09090B` UI throughout

---

## ⚖️ Key Tradeoffs & Design Decisions

1. **Edge STT vs. Cloud STT:** I chose to run Whisper natively in the candidate's browser via WebAssembly (`@xenova/transformers`).
   * *Tradeoff:* Requires a brief 30MB model download during onboarding.
   * *Benefit:* Eliminates audio upload latency, reduces backend compute costs to zero, and ensures maximum privacy.
2. **Sentence-Level Streaming vs. Block Generation:**
   * *Tradeoff:* Increased backend complexity managing async Queues and WebSocket chunks.
   * *Benefit:* Reduces conversational latency from ~8 seconds down to <2 seconds. Maya speaks while the LLM is still generating.
3. **The 'Silence Guard':**
   * *Decision:* The system enforces a strict >15 word minimum.
   * *Benefit:* Solves the edge case of candidates attempting to 'game' the system or abandon the interview, preventing wasted LLM tokens on empty evaluations.

---

## Scoring Rubric

| Dimension | Weight | What Maya Listens For |
|---|---|---|
| Communication Clarity | 30% | Explains simply, avoids jargon, uses analogies |
| Warmth & Empathy | 20% | Acknowledges frustration, makes students feel safe |
| Patience & Composure | 20% | No rushing, comfortable with silence |
| Adaptability | 20% | Pivots approach when one explanation fails |
| English Fluency | 10% | Natural, clear, grammatically comfortable |

**Pass threshold:** weighted average ≥ 3.0 / 5.0

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Python 3.11, FastAPI, WebSockets |
| STT | `@xenova/transformers` (Whisper base.en, runs in-browser via ONNX) |
| LLM | Groq API — `llama-3.3-70b-versatile` |
| TTS | Sarvam AI (primary) · Piper (local fallback) |
| Database | PostgreSQL via SQLAlchemy (Supabase-compatible) |
| Email | Resend |
| Auth | JWT (admin dashboard) |
| Deployment | Vercel (frontend) · Render (backend) |

---

## Project Structure

```
.
├── frontend/                  # Next.js application
│   ├── app/
│   │   ├── page.tsx           # Landing / home
│   │   ├── onboarding/        # Candidate name + email form
│   │   ├── interview/[id]/    # Live interview room (WebSocket + waveform)
│   │   ├── results/[id]/      # Score breakdown + PDF download
│   │   └── admin/             # Password-protected recruiter dashboard
│   ├── components/
│   │   └── LiveCanvasWaveform.tsx
│   ├── next.config.js         # COOP/COEP headers for SharedArrayBuffer
│   └── vercel.json
│
├── backend/
│   ├── main.py                # FastAPI app — WebSocket, scoring, TTS, DB, admin API
│   ├── requirements.txt
│   ├── Procfile               # Render start command
│   ├── render-build.sh        # Render build script (system deps + pip)
│   ├── .env.example           # All required environment variables
│   ├── piper/                 # Piper TTS binary (not in git — add manually)
│   └── models/                # Piper voice models (not in git — add manually)
│
├── .gitignore
└── README.md
```

---

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- A PostgreSQL database (Supabase free tier works)
- Groq API key ([console.groq.com](https://console.groq.com))

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Fill in DATABASE_URL, GROQ_API_KEY, and optionally SARVAM_API_KEY

uvicorn main:app --reload --port 8000
```

> **Piper TTS (optional fallback):** Download the binary and a voice model into `backend/piper/` and `backend/models/`. If `SARVAM_API_KEY` is set, Piper is never used.

### Frontend

```bash
cd frontend
npm install

# .env.local is pre-configured for localhost — no changes needed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `GROQ_API_KEY` | ✅ | Groq API key for LLM + scoring |
| `SARVAM_API_KEY` | ⬜ | Sarvam TTS key (falls back to Piper if absent) |
| `ADMIN_PASSWORD` | ✅ | Password for `/admin` dashboard |
| `JWT_SECRET` | ✅ | Secret for signing admin JWT tokens |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated CORS origins — supports `*.vercel.app` wildcards |
| `RESEND_API_KEY` | ⬜ | Resend key for email notifications |
| `ADMIN_EMAIL` | ⬜ | Recruiter email for pass alerts |
| `FROM_EMAIL` | ⬜ | Verified sender address in Resend |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend HTTP base URL |
| `NEXT_PUBLIC_WS_URL` | Backend WebSocket URL (`ws://` or `wss://`) |

---

## Deployment

### Backend → Render

1. **New Web Service** → connect this repo → set **Root Directory** to `backend`
2. **Build command:** `./render-build.sh`
3. **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add all environment variables from `.env.example`
5. Set `ALLOWED_ORIGINS` to include your Vercel URL and `*.vercel.app`

### Frontend → Vercel

1. **Import** this repo → set **Root Directory** to `frontend`
2. Add environment variables:
   - `NEXT_PUBLIC_API_URL` → `https://your-service.onrender.com`
   - `NEXT_PUBLIC_WS_URL` → `wss://your-service.onrender.com/ws`
3. **Deploy** — Next.js is auto-detected, no further config needed

> **WebSocket note:** Render's free tier spins down after inactivity. Use a paid instance or a keep-alive ping for production workloads.

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Render health check |
| `POST` | `/api/admin/login` | — | Returns JWT token |
| `GET` | `/api/admin/candidates` | Bearer JWT | All completed interviews |
| `GET` | `/api/results/{id}` | — | Single candidate result |
| `WS` | `/ws` | — | Live interview WebSocket |

### WebSocket Message Flow

```
Client → Server:  init_session  { candidate_id, name, email }
Client → Server:  start_interview
Server → Client:  thinking
Server → Client:  audio_chunk + <binary WAV>   (repeats per sentence)
Server → Client:  turn_end      { full_text }
Client → Server:  user_message  { text }       (after Whisper transcription)
   ... (loop) ...
Server → Client:  interview_complete
Server → Client:  interview_results  { data: scores }
Client → Server:  end_interview                (if user clicks End early)
```

---

## License

MIT
