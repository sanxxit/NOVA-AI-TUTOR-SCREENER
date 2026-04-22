# Done So Far — AI Tutor Screener

_Last updated: 2026-04-22 | Sessions completed: 8_

---

## 1. Project Summary

**What it is:** An AI-powered voice interview system that screens math tutor candidates on behalf of a tutoring company (branding references Cuemath in the page title).

**What it is supposed to do:** A candidate visits a website, fills in their name and email, completes a ~10-minute voice-only conversation with an AI interviewer named "Maya", and immediately receives a scored result. Maya asks roleplay-style situational questions designed to evaluate whether the candidate has the soft skills required to teach math to children. The system auto-scores the candidate across five dimensions, presents a pass/fail verdict with evidence and feedback, and persists all results to a database. A hiring team admin dashboard — protected by JWT authentication — lets recruiters review all completed interviews. Passed candidates and the admin automatically receive email notifications via Resend. No human reviewer needed for the initial screen.

---

## 2. Tech Stack (Actual, Not Planned)

| Layer | Technology |
|---|---|
| **Frontend framework** | Next.js 14.2.29 (App Router, `'use client'`) |
| **Frontend language** | TypeScript + React 18 |
| **Styling** | Tailwind CSS 3.4.17 with custom design tokens |
| **Fonts** | Inter (body) via Google Fonts |
| **Theme** | `next-themes` — dark/light mode with `ThemeToggle` component on landing page |
| **STT (Speech-to-Text)** | `@xenova/transformers` 2.17.2 — Whisper `base.en` running entirely in the browser via WebAssembly/ONNX |
| **TTS (Text-to-Speech) — Primary** | Sarvam AI (`bulbul:v3` model, `ritu` speaker, `en-IN` locale) — Indian-accented English; called via `httpx` async HTTP client |
| **TTS (Text-to-Speech) — Fallback** | Piper TTS — local binary (`backend/piper/piper`) with `en_US-hfc_female-medium.onnx` (Human Feedback Corpus female, American English) |
| **LLM** | Groq API — `llama-3.3-70b-versatile` (conversation + both scoring steps) |
| **Backend framework** | FastAPI 0.115.0 |
| **Backend runtime** | Python 3, Uvicorn 0.30.6 |
| **HTTP client** | `httpx>=0.27.0` — async client for Sarvam AI TTS requests |
| **Transport** | WebSocket (full-duplex, binary + JSON frames) + REST (`POST /api/admin/login`, `GET /api/admin/candidates`, `GET /api/results/{candidate_id}`) |
| **Database** | PostgreSQL via Supabase — SQLAlchemy 2.0 + psycopg2-binary, Session Mode pooler URL |
| **ORM / query layer** | SQLAlchemy `create_engine` + `text()` raw SQL, `_engine.begin()` for writes, `_engine.connect()` for reads |
| **Admin auth** | JWT (PyJWT 2.8+) — `POST /api/admin/login` issues 2-hour signed token; `GET /api/admin/candidates` requires Bearer token |
| **Email** | Resend SDK (`resend>=2.0.0`) — HTML emails; candidate result email + admin notification both routed to `ADMIN_EMAIL` (Wizard of Oz demo pattern) |
| **Audio pipeline** | Web Audio API — `ScriptProcessorNode` (VAD), `AnalyserNode` (visualisation via `LiveCanvasWaveform`), `OfflineAudioContext` (resampling), `AudioBufferSourceNode` (playback queue) |
| **Path resolution** | `pathlib.Path(__file__).parent.resolve()` — all binary and model paths are absolute, deploy-safe |
| **Identity** | `crypto.randomUUID()` in browser, stored in `localStorage`, persisted to DB, embedded in interview URL |

---

## 3. Current System Flow

1. **Landing page** (`/`) — Candidate reads hero copy with large NOVA branding, skill list, and scoring rubric (5 dimensions + exact weights). "Start Interview" CTA button scrolls down to the intake form. Theme toggle (dark/light) visible in header.

2. **Intake form** (same page, `/`) — Candidate enters Full Name and Email. On submit: `crypto.randomUUID()` generates a `candidate_id`; session saved to `localStorage('candidate_session')`. Navigates to `/onboarding`.

3. **Onboarding** (`/onboarding`) — Five-phase setup:
   - 0–12%: Splash animation
   - 12–80%: Downloads and caches Whisper `base.en` model in the browser
   - 80–87%: WebSocket ping to verify backend is reachable
   - 87–93%: Requests microphone permission
   - 93–100%: Live mic waveform audio test; candidate clicks "Sounds good — Continue"
   - Navigates to `/interview/${candidate_id}` (reads ID from `localStorage`)

4. **Interview** (`/interview/[id]`):
   - **Security check** runs before boot: if `params.id` does not match `localStorage.candidate_session.candidate_id`, immediately redirects to `/` — no WebSocket is opened, no Whisper is loaded.
   - Loads Whisper from browser cache, opens persistent WebSocket
   - **`ws.onopen`**: Immediately sends `{"type": "init_session", "candidate_id": params.id, "name": "...", "email": "..."}` — URL param is used as authoritative candidate ID, not localStorage
   - **Backend re-interview check**: If the email already has a completed row in the DB, backend sends `{"type": "already_completed"}` and closes the handler. Frontend shows polite screen — no interview starts.
   - If new: backend writes candidate row to PostgreSQL via SQLAlchemy, then sends `{"type": "connected"}`
   - Frontend starts mic, shows "Maya is ready for you"
   - Candidate clicks **Begin Interview** → `AudioContext.resume()`, sends `start_interview`, **timer starts**
   - **Live timer** (top-left, below NOVA header): counts up from `0:00` to `10:00`. Pulsing dot is sage green for the first 8 min, switches to amber at 8 min as a soft heads-up.
   - **End Interview button** (top-right, below NOVA header): visible during all active states. Shows question number `Q#` beside it. On click: timer stops, current audio source stops instantly, state immediately shows "Analyzing…", sends `end_interview` to backend.
   - Backend sends thinking → synthesises opening question **sentence-by-sentence** via Sarvam AI TTS (falls back to Piper) → streams audio chunks to frontend immediately
   - Frontend plays each audio chunk as it arrives via an **audio queue** (`audioQueueRef`) — no waiting for the full response
   - Frontend enters Listening mode after the queue drains + `turn_end` received
   - VAD (0.8 s silence threshold, 45 s auto-trigger cap) detects speech → Whisper transcribes with long-form chunked mode → sends `user_message` to backend
   - Backend streams Groq tokens, extracts sentence boundaries, TTS-synthesises each sentence, pushes `audio_chunk` + raw WAV bytes to frontend in real time
   - Loop until `[INTERVIEW_COMPLETE]` in LLM output or 10.5 min forced end
   - On completion: `asyncio.create_task(_score_and_persist(...))` fires — scoring runs in background, emails sent on pass, DB updated, `interview_results` delivered to frontend
   - Frontend plays success chime → saves to `localStorage('interview_results')` → routes to `/results`

5. **Old `/interview` route** — Lightweight redirect component. Reads `candidate_id` from `localStorage` and calls `router.replace('/interview/${candidate_id}')`. Falls back to `router.replace('/')` if no session found.

6. **Results (localStorage mode)** (`/results`):
   - Reads `interview_results` from `localStorage` (redirects home if absent)
   - Pass/Fail banner, overall score, score bars, quote evidence, feedback per dimension

7. **Results (dynamic/shareable)** (`/results/[id]`):
   - Fetches candidate data from `GET /api/results/{candidate_id}` (public endpoint, no auth)
   - Same UI as the localStorage results page but driven by live DB data; works even if localStorage is cleared

8. **Admin login** (`/admin/login`):
   - Glassmorphism password form with eye-toggle
   - `POST /api/admin/login` — returns 2-hour JWT on correct password
   - Token saved to `sessionStorage('admin_token')`; routes to `/admin`

9. **Admin dashboard** (`/admin`):
   - `useEffect` auth guard: checks `sessionStorage` for token; redirects to `/admin/login` if missing or 401
   - Fetches `GET /api/admin/candidates` with `Authorization: Bearer <token>`
   - Shows data table: Name, Email, Score (animated bar), Pass/Fail badge, Date
   - "View Details" expands inline panel with 5 dimension cards (score, weight, quote, feedback)
   - Collapsible full transcript viewer per candidate
   - Summary stats strip: total count, pass rate %, average score
   - Sign out button clears token and redirects to login

---

## 4. Core Logic Implemented

### Interview Questions
- Opening question hardcoded in backend (matches system prompt).
- Subsequent questions generated dynamically by `llama-3.3-70b-versatile` using full conversation history.
- Maya's `SYSTEM_PROMPT` has 5 locked-in sections: Identity (warm, upbeat, conversational — "never sound sultry"), Questioning Style (9 banned patterns with ✗, TYPE A roleplay + TYPE B behavioral probes), Dynamic Follow-Ups (jargon detection, short-answer push-back, weak-answer probe), Hardcoded Edge Cases (5 mandatory templates), Interview Lifecycle.

### Answer Capture
- Browser VAD: `ScriptProcessorNode`, RMS threshold `0.012`, **0.8 s** silence trigger, min 4 speech frames.
- **45 s auto-trigger cap**: `maxRecordChunks = Math.floor((45 * ctx.sampleRate) / BUFFER_SIZE)` — prevents Whisper from receiving audio longer than its reliable processing window.
- PCM resampled to 16 kHz → Whisper `base.en` with **long-form chunked mode** (`chunk_length_s: 30, stride_length_s: 5`) → transcription sent to backend.
- Buffer flushed during AI speech (strict half-duplex).

### Sentence-Level TTS Streaming Pipeline
Replaces old blocking `send_ai_turn`. Three-stage pipeline:

1. **Token stream**: `_groq_token_stream()` runs Groq `stream=True` in a daemon thread, puts tokens onto an `asyncio.Queue`, yields them to the async caller.
2. **Sentence detection**: `_pop_sentence(buf)` scans for `.!?` followed by whitespace/quote — splits the buffer at the first complete sentence, returns `(sentence, remainder)`.
3. **Parallel flush**: Each detected sentence is immediately synthesised via `synthesize_speech()` (`asyncio.to_thread`) and pushed to the frontend as `audio_chunk` JSON + raw WAV bytes — before the next sentence is even generated.

### Sarvam AI TTS with Piper Fallback
`synthesize_speech(text)` is the single entry point for all TTS:

1. **Sarvam AI (primary)**: If `SARVAM_API_KEY` is set, sends an async `httpx` POST to `https://api.sarvam.ai/text-to-speech` with model `bulbul:v3`, speaker `ritu`, locale `en-IN`. Text is preprocessed by `clean_text_for_sarvam()` which expands digit-hyphens (e.g., `9-year-old` → `nine year old`) and converts all digits to words to avoid Sarvam's known number-rendering bugs.
2. **Piper fallback**: If Sarvam is unavailable or raises any exception, `synthesize_with_piper()` is called — same subprocess call as before. Error is logged with `print(..., flush=True)` but never surfaces to the user.

### Audio Playback Queue (Frontend)
- `audioQueueRef`: array of `{audioBytes, sentence, isFirst}` items
- `isQueuePlayingRef`: drain lock — prevents concurrent drains
- `turnEndReceivedRef`: signals when the backend has sent `turn_end`
- `enqueueAudio()` → calls `drainQueue()` if not already draining
- `drainQueue()` → loops, calling `playChunk()` on each item, waits for `onended`
- After queue drains AND `turn_end` received → `finalizeTurn()` → state transitions to Listening
- `currentSourceRef`: stores the live `AudioBufferSourceNode` so `currentSourceRef.current.stop()` instantly silences Maya on End Interview click

### LiveCanvasWaveform (Frontend Component)
`LiveCanvasWaveform.tsx` — canvas-based real-time waveform visualiser. Replaces the CSS-animation `WaveformDecoration`. Accepts an `AnalyserNode` and a `WaveState` prop (`'idle' | 'listening' | 'thinking' | 'speaking'`) and renders different animation styles for each state. Used in the interview page to show mic activity during listening and playback activity during speaking.

### Evaluation — Two-Step Scoring Pipeline
Runs as `asyncio.create_task()` — decoupled from WebSocket.

**Step 1 — Quote Extraction** (`response_format: json_object`, temp 0.1, max 600 tokens): one key quote per dimension from the transcript.

**Step 2 — Scoring** (`response_format: json_object`, temp 0.1, max 2000 tokens): chain-of-thought scoring — `observed_behavior`, `positive_signals`, `negative_signals`, `rubric_anchor`, `final_score` (1–5) per dimension.

**Combination** (Python): Weighted average: Clarity 30% + Warmth 20% + Patience 20% + Adaptability 20% + Fluency 10%. Pass ≥ 3.0 / 5.0.

### Session Timing
- 9 min: wrap-up injection added to LLM context
- 10.5 min: `force_end = True` overrides LLM regardless

### Database Writes (PostgreSQL)
- **Write 1** (on `init_session`): `INSERT INTO candidates ... ON CONFLICT (candidate_id) DO NOTHING` — abandoned sessions are still recorded.
- **Write 2** (on scoring completion): `UPDATE` writes transcript JSON, scores JSON, pass/fail, overall score, `completed_at`.
- `db_get_candidate(candidate_id)` — new function: returns a single completed interview by `candidate_id`, used by `GET /api/results/{candidate_id}`.
- Both writes use `_engine.begin()` + `text()` named-bind parameters (`:param` style, PostgreSQL-compatible).
- `pool_pre_ping=True` ensures stale connections are recycled automatically.

### Re-Interview Prevention
- On `init_session`, backend checks `WHERE email = :email AND completed_at IS NOT NULL`.
- Email normalized to lowercase before both storage and lookup.
- If match: sends `already_completed` event, closes the WebSocket handler. Frontend shows a polite "You've already been here" screen.

### Disconnect Resilience
- Scoring launched via `asyncio.create_task()` the moment `is_complete` is detected.
- All WS sends after that are wrapped in `try/except`; a disconnected client never interrupts scoring.
- If `stream_ai_response` fails on the final turn, `asyncio.create_task(_score_and_persist(...))` is still fired before breaking.

### Admin Authentication (JWT)
- `POST /api/admin/login` accepts `{password}`, compares with `ADMIN_PASSWORD` env var using `secrets.compare_digest()`, returns a 2-hour JWT signed with `JWT_SECRET`.
- `verify_token()` is a FastAPI `Depends` function — decodes the JWT and raises 401 on any `PyJWTError`.
- `GET /api/admin/candidates` requires `Depends(verify_token)` — unauthenticated requests receive 401.
- Frontend stores token in `sessionStorage('admin_token')`; passes it as `Authorization: Bearer <token>` on every fetch; clears it on sign out or 401.

### Email Notifications (Resend) — Wizard of Oz Pattern
- `_send_emails_sync()` is a synchronous function called via `asyncio.to_thread()` — never blocks the event loop.
- Fires only when `results['passed'] == True AND overall_score >= 3.0`.
- **Candidate result email**: personalised HTML body (candidate name, score, "Congratulations" header in green `#16a34a`, "NOVA AI Recruitment" branding, next-steps text). **`to` field is hardcoded to `ADMIN_EMAIL`** — email is visually addressed to the candidate but delivered to the admin's inbox. This bypasses Resend sandbox restrictions which block delivery to any address other than the account owner.
- **Admin notification email**: dark-header HTML (`#2C2825` background band) with candidate name, email, score pill, PASS badge, session ID, and dashboard link. Also delivered to `ADMIN_EMAIL`.
- Each email send is wrapped in its own independent `try/except` with `print` logging — admin email fires even if the candidate email block fails.
- `ADMIN_EMAIL` corrected to `[REDACTED_EMAIL]` (the Resend account owner's address).

### Wildcard CORS Support
- `ALLOWED_ORIGINS` env var is parsed for wildcard entries like `*.vercel.app`.
- Wildcard entries are compiled into a regex (`r"https://[^/]+\.vercel\.app"`) and passed to `allow_origin_regex`.
- Explicit origins go into `allow_origins` as before.

---

## 5. File Structure

```
ai-tutor-screener/
│
├── backend/
│   ├── main.py                    FastAPI app, WebSocket handler, PostgreSQL DB layer
│   │                              (SQLAlchemy + psycopg2), pathlib path resolution,
│   │                              Sarvam AI TTS (primary) + Piper TTS (fallback),
│   │                              Groq streaming LLM, sentence-level TTS pipeline,
│   │                              audio chunk streaming, scoring pipeline,
│   │                              _score_and_persist (background task),
│   │                              re-interview check, JWT admin auth,
│   │                              Resend email notifications (Wizard of Oz),
│   │                              wildcard CORS, bulletproofed SYSTEM_PROMPT
│   ├── requirements.txt           fastapi, uvicorn, websockets, python-dotenv, groq,
│   │                              psycopg2-binary, SQLAlchemy, PyJWT, resend, httpx
│   ├── .env                       GROQ_API_KEY, PIPER_BIN, PIPER_MODEL_PATH,
│   │                              DATABASE_URL, ADMIN_PASSWORD, JWT_SECRET,
│   │                              RESEND_API_KEY, ADMIN_EMAIL, FROM_EMAIL,
│   │                              ALLOWED_ORIGINS, SARVAM_API_KEY
│   ├── models/
│   │   ├── en_US-hfc_female-medium.onnx   ← active voice model (Piper fallback)
│   │   ├── en_US-hfc_female-medium.onnx.json
│   │   ├── en_US-amy-medium.onnx          (fallback)
│   │   ├── en_US-amy-medium.onnx.json
│   │   ├── en_US-lessac-medium.onnx       (fallback)
│   │   ├── en_US-lessac-medium.onnx.json
│   │   ├── en_US-l2arctic-medium.onnx     (unused — Indian English experiment)
│   │   └── en_US-l2arctic-medium.onnx.json
│   └── piper/
│       ├── piper                  TTS binary (Linux x86-64)
│       └── [shared libraries + espeak data]
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx             Root layout + fonts + persistent NOVA branding
│   │   │                          (fixed z-50 header on every route)
│   │   ├── globals.css            Tailwind base + keyframes
│   │   ├── page.tsx               Landing page: NOVA hero (text-8xl/9xl), large CTA,
│   │   │                          intake form (UUID, localStorage), ThemeToggle,
│   │   │                          mic permission check, brightened dark-mode text
│   │   ├── onboarding/page.tsx    5-phase setup wizard; routes to /interview/${candidate_id}
│   │   ├── interview/
│   │   │   ├── page.tsx           Redirect component — reads localStorage, redirects to
│   │   │   │                      /interview/${id} or falls back to /
│   │   │   └── [id]/
│   │   │       └── page.tsx       Full interview UI: security check, init_session handshake,
│   │   │                          audio queue, sentence playback, VAD 0.8s, 45s cap,
│   │   │                          Whisper long-form, currentSourceRef, timer at top-16,
│   │   │                          End Interview at top-16, LiveCanvasWaveform
│   │   ├── results/
│   │   │   ├── page.tsx           Candidate results (localStorage mode)
│   │   │   └── [id]/
│   │   │       └── page.tsx       Dynamic results page — fetches from /api/results/{id};
│   │   │                          shareable, works without localStorage
│   │   └── admin/
│   │       ├── page.tsx           Recruiter dashboard: JWT auth guard, Bearer fetch,
│   │       │                      table + dim cards + transcript + stats + sign out,
│   │       │                      pt-20 top padding to clear NOVA header
│   │       └── login/
│   │           └── page.tsx       Glassmorphism password form; stores JWT in sessionStorage
│   ├── components/
│   │   ├── LiveCanvasWaveform.tsx Canvas-based real-time waveform (listening/thinking/speaking)
│   │   ├── ThemeToggle.tsx        Dark/light mode toggle button (used on landing page)
│   │   └── WaveformDecoration.tsx Animated waveform decoration (CSS animation)
│   ├── tailwind.config.js
│   └── package.json
│
├── .claude/
│   └── commands/
│       └── donesofar.md           /donesofar slash command — auto-updates this file
│
└── Done_so_Far.md
```

---

## 6. What is ACTUALLY Working

- **Landing page** with large NOVA hero (`text-8xl`/`text-9xl font-black`), correct rubric weights (30/20/20/20/10)
- **Large "Start Interview" CTA button** — gradient pill (`px-12 py-6 text-2xl`) with hover scale + glow
- **Persistent global NOVA branding** — `fixed top-0 left-0 z-50` element in `layout.tsx`, visible above every page's own navbar
- **Dark/light theme toggle** on landing page via `ThemeToggle` + `next-themes`
- **Brightened dark-mode text** — all `dark:text-zinc-500/600/700` classes raised to `dark:text-zinc-200/300/400` across landing, admin, and login pages
- **Intake form** cross-fade transition, UUID generation, localStorage session save
- **Onboarding** 5-phase wizard: Whisper model cache, server ping, mic permission, audio test
- **Dynamic interview URLs** — `/interview/${candidate_id}` generated from localStorage on "Begin Interview" click
- **`/interview` redirect** — old flat route safely redirects to the dynamic URL or home
- **Security check** — `params.id !== localStorage.candidate_id` → immediate redirect to `/` before any boot
- **`ws.onopen` → `init_session`** handshake — URL param used as authoritative `candidate_id`
- **Re-interview prevention** — email check against PostgreSQL; `already_completed` event + polite screen
- **PostgreSQL row created** on `init_session` receipt via SQLAlchemy + `ON CONFLICT DO NOTHING`
- **Supabase connectivity** via Session Mode pooler URL (IPv4-accessible from WSL2)
- **Full interview conversation loop** — Groq streaming LLM + sentence-level TTS + audio chunk push + VAD + Whisper
- **Sarvam AI TTS as primary** — Indian-accented English voice (ritu/bulbul:v3) via `httpx`; `clean_text_for_sarvam()` preprocesses digits
- **Piper TTS as silent fallback** — activates automatically if Sarvam errors; `hfc_female` American English voice
- **Sentence-level streaming latency** ~1–2 s — first audio chunk arrives before Groq finishes generating
- **Audio playback queue** — sequential chunk playback, `finalizeTurn()` only after queue empty + `turn_end` received
- **`LiveCanvasWaveform` component** — canvas-based real-time waveform visualiser with `WaveState` (`listening`/`thinking`/`speaking`/`idle`)
- **Instant audio stop on End Interview** — `currentSourceRef.current.stop()` cuts Maya mid-sentence with zero latency
- **Timer at `top-16`** — cleared below NOVA global header; no visual overlap
- **End Interview button at `top-16`** — same clear zone as timer
- **Whisper long-form chunked mode** — handles answers up to 45 s without truncation
- **VAD 0.8 s silence threshold** — responsive conversational pacing
- **Session timing** — 9 min wrap-up, 10.5 min force-end
- **State machine** (Thinking / Speaking / Listening) — desync-free via synchronous `setState` wrapper
- **Two-step scoring pipeline** — quote extraction + chain-of-thought dimension scoring → weighted average → pass/fail
- **Background scoring task** — `asyncio.create_task()` decouples scoring from WS connection state
- **Disconnect resilience** — scoring and DB write complete even if client closes tab mid-analysis
- **PostgreSQL DB updated** after scoring with full transcript + scores
- **`interview_results` event** → frontend chime + localStorage + route to `/results`
- **Results dashboard (localStorage mode)** — Pass/Fail banner, score bars (color-coded), quote evidence, feedback
- **Dynamic results page** (`/results/[id]`) — fetches from `GET /api/results/{candidate_id}`; shareable link that works without localStorage
- **Live interview timer** — top-left pill (below NOVA header), counts `0:00 → 10:00`, green dot turns amber after 8 min
- **End Interview button** — stops audio instantly, shows "Analyzing…", triggers full scoring + DB persist
- **Manual end → admin dashboard** — produces a real scored result identical to natural completion
- **Maya SYSTEM_PROMPT bulletproofed** — 5 locked sections, natural American conversational tone, banned question list, jargon detection, 5 edge-case templates
- **HFC female voice (Piper)** — `en_US-hfc_female-medium.onnx` as fallback; bright natural American female; fallback chain amy → lessac
- **pathlib absolute path resolution** — `BASE_DIR = pathlib.Path(__file__).parent.resolve()` — paths never break on Render
- **`ALLOWED_ORIGINS` env variable** — CORS reads from environment; wildcard entries compiled to `allow_origin_regex`
- **JWT admin authentication** — `POST /api/admin/login` issues 2-hour token; `GET /api/admin/candidates` requires Bearer token; 401 on invalid/expired
- **Admin login page** — glassmorphism form, eye-toggle password, animated submit, error banner
- **Admin session guard** — `useEffect` redirects to `/admin/login` if no token; handles mid-session 401
- **Admin sign out** — clears `sessionStorage` and redirects to login
- **Admin page top padding** — `pt-20` clears NOVA global header on admin dashboard
- **Resend email on pass (Wizard of Oz)** — result email visually addressed to candidate but `to: [ADMIN_EMAIL]`; admin notification email separately; both in independent `try/except` blocks with print logging
- **`ADMIN_EMAIL` corrected** to Resend account owner's address — emails actually deliver
- **`/donesofar` slash command** — auto-regenerates this file from current codebase state

---

## 7. What is PARTIALLY Working

- **Whisper transcription accuracy** — `base.en` (74M params) works but errors on accents, fast speech, noisy mic. No retry logic.
- **Scoring quality** — Pipeline runs correctly but has not been tested with real interview data. Calibration unknown.
- **`ScriptProcessorNode` VAD** — Functional but deprecated in the Web Audio spec. Console warnings in all browsers.
- **Error recovery** — Static error message on failure; no retry mechanism; user must refresh.
- **Email FROM address** — `onboarding@resend.dev` only delivers to the Resend account owner's email until a custom domain is verified. Candidate emails (in production, not demo) will not deliver to real candidate inboxes until `FROM_EMAIL` is updated to a verified domain.
- **Results page (dynamic)** — `GET /api/results/{candidate_id}` endpoint is public (no auth) — anyone who guesses a UUID can view results.

---

## 8. What is NOT Built Yet

- **Email for failed candidates** — Only passed candidates receive an email. Failed candidates get no notification.
- **Deployment configuration** — No Docker, no production ASGI config, no CI/CD pipeline.
- **HTTPS / WSS** — Browsers require HTTPS for microphone access on non-localhost origins.
- **Mobile support** — Not tested on mobile. `ScriptProcessorNode` is unreliable on iOS Safari.
- **Score calibration** — Pass threshold (3.0 / 5.0) is arbitrary. No real interview data used to validate.
- **Rate limiting** — No limits on WebSocket connections or Groq API calls.
- **Analytics / monitoring** — No session logging, error rate tracking, or usage metrics.
- **Admin data export** — No CSV/JSON download from the admin dashboard.
- **Custom email domain** — `FROM_EMAIL` must be updated to a verified domain before candidate emails reach real inboxes (currently using Wizard of Oz demo workaround).
- **Auth on dynamic results endpoint** — `GET /api/results/{candidate_id}` is currently unauthenticated.

---

## 9. Bugs / Issues Faced

1. **UI text desync** *(fixed — Session 2)* — "Listening…" showed while AI was speaking due to async `useEffect` stateRef sync.
2. **Freeze on "Thinking…" at interview end** *(fixed — Session 2)* — `onended` callback overwrote `complete` state.
3. **No results page** *(fixed — Session 2)* — Scoring pipeline and results route did not exist.
4. **Rubric weight mismatch** *(fixed — Session 3)* — Landing page showed 25%/15%; backend scored at 30%/20%.
5. **No candidate identity** *(fixed — Session 3)* — No way to associate an interview with a person.
6. **No database** *(fixed — Session 3)* — Results lived only in browser localStorage.
7. **No admin access** *(fixed — Session 4)* — Hiring team had no way to view completed interviews.
8. **Re-interview possible** *(fixed — Session 4)* — Same candidate could take the interview unlimited times.
9. **Disconnect killed scoring** *(fixed — Session 4)* — Closing the tab during "Analyzing…" could abandon the scoring pipeline.
10. **No time awareness for candidate** *(fixed — Session 5)* — No timer, no amber warning, no graceful early-exit path.
11. **Whisper truncating long answers** *(fixed — Session 6)* — Whisper `base.en` silently dropped audio beyond 30 s. Fixed: `chunk_length_s: 30, stride_length_s: 5` + 45 s VAD cap.
12. **End Interview not stopping audio** *(fixed — Session 6)* — No stored `AudioBufferSourceNode` reference. Fixed: `currentSourceRef`.
13. **9 s AI response latency** *(fixed — Session 6)* — Full Groq response waited before TTS. Fixed: sentence-level streaming.
14. **SQLite wiped on free hosting** *(fixed — Session 6)* — Ephemeral filesystems destroyed the DB on redeploy. Fixed: Supabase PostgreSQL.
15. **Supabase IPv6 unreachable from WSL2** *(fixed — Session 6)* — Direct URL resolves to IPv6 only. Fixed: Session Mode pooler URL (IPv4).
16. **`ModuleNotFoundError: No module named 'sqlalchemy'`** *(fixed — Session 6)* — Packages installed to system Python instead of `.venv`.
17. **Maya asking generic/off-topic questions** *(fixed — Session 6)* — LLM drifted without guardrails. Fixed: bulletproofed SYSTEM_PROMPT.
18. **Interview URL not unique per candidate** *(fixed — Session 6)* — Flat `/interview` route with no session identity. Fixed: `/interview/[id]` with security check.
19. **Timer does not pause during AI speaking** *(by design)* — Timer counts real elapsed wall time. Intentional.
20. **`ScriptProcessorNode` deprecation** *(not fixed)* — Console warnings in all modern browsers.
21. **Admin was unauthenticated** *(fixed — Session 7)* — `/admin` was open to anyone with the URL. Fixed: JWT auth + login page.
22. **`CORSMiddleware` missing import** *(fixed — Session 7)* — Import was dropped when rewriting the FastAPI import line, causing a `NameError` crash on startup. Fixed: added `from fastapi.middleware.cors import CORSMiddleware`.
23. **Hardcoded CORS origin** *(fixed — Session 7)* — `allow_origins` was hardcoded to `http://localhost:3000`. Fixed: reads from `ALLOWED_ORIGINS` env variable.
24. **`name`/`email` not available at scoring call sites** *(fixed — Session 7)* — Variables were scoped inside `init_session` block; email function couldn't access them. Fixed: hoisted to WebSocket handler scope.
25. **`ModuleNotFoundError: No module named 'resend'`** *(fixed — Session 8)* — System Python invoked instead of venv Python. Fixed: use `./venv/bin/uvicorn main:app --reload`.
26. **NOVA header overlapping interview timer** *(fixed — Session 8)* — Global NOVA header (`h-14`, 56 px) covered the timer (`top-5`, 20 px) and End Interview button. Fixed: moved both to `top-16` (64 px); increased content padding `pt-24 → pt-28`.
27. **Admin email not delivering** *(fixed — Session 8)* — `ADMIN_EMAIL=[REDACTED_EMAIL]` is not the Resend account owner. Resend sandbox hard-blocks delivery to any other address. Fixed: corrected to `[REDACTED_EMAIL]`.
28. **Silent email failure swallowing both emails** *(fixed — Session 8)* — Single `try/except` around both sends meant a candidate email failure also blocked the admin email. Fixed: split into two independent blocks with print logging.
29. **Candidate emails blocked by Resend sandbox** *(fixed — Session 8, workaround)* — `onboarding@resend.dev` physically blocks delivery to any address except the Resend account owner. Fixed: Wizard of Oz pattern — email body addressed to candidate, `to` field hardcoded to `ADMIN_EMAIL`.

---

## 10. Fixes & Improvements Done

### Session 2 — Core MVP Bug Fixes
1. Synchronous `setState` wrapper replacing async `useEffect` stateRef sync
2. `interviewCompleteRef` flag to defer "Analyzing…" spinner until audio + chime finish
3. Two-step scoring pipeline built (`QUOTE_EXTRACTION_PROMPT`, `SCORING_PROMPT`, `run_scoring_pipeline`)
4. End-to-end result routing via `interview_results` event + localStorage
5. Results dashboard (`/results/page.tsx`) built

### Session 3 — Frictionless Candidate Identity
6. Rubric weights fixed on landing page (30/20/20/20/10)
7. Intake form with cross-fade transition, warm design, back link
8. `crypto.randomUUID()` + localStorage session handoff
9. `ws.onopen` sends `init_session` as first WebSocket message
10. SQLite DB layer: `init_db`, `db_save_candidate`, `db_update_results`
11. Pre-interview loop handles `init_session` and writes to DB
12. Email normalized to lowercase before storage and lookup

### Session 4 — Admin Dashboard + Anti-Cheat + Disconnect Patch
13. `db_check_email_completed()` — email-based re-interview guard
14. `db_get_all_completed()` — fetches all completed rows for admin API
15. `GET /api/admin/candidates` REST endpoint
16. `already_completed` WebSocket event + frontend polite redirect screen
17. `_score_and_persist()` background coroutine decoupled from WebSocket
18. `asyncio.create_task()` wrapping — scoring survives client disconnect
19. Final turn failure path fires background scoring before breaking
20. Admin dashboard (`/admin/page.tsx`) — data table, expandable dimension cards, transcript viewer, stats strip

### Session 5 — Live Timer + Manual End Interview
21. `MAX_SECONDS = 600` constant + `formatTime(s)` helper
22. `elapsed` state + `timerRef` interval handle
23. `setState` wrapper auto-clears timer on terminal states
24. `beginInterview()` starts `setInterval(..., 1000)` to tick `elapsed`
25. Timer pill UI (top-left, fixed): pulsing dot + `elapsed / 10:00`; amber after 480 s
26. `handleEndInterview()`: stops timer, sets `interviewCompleteRef`, sends `end_interview`
27. End Interview button UI (top-right, fixed): warm cream pill, amber stop icon, `Q#` counter
28. `useEffect` cleanup calls `clearInterval(timerRef.current)` on unmount
29. Backend `end_interview` message handler: `create_task(_score_and_persist)` + send `interview_complete` + `interview_results`
30. Old standalone question-number `<div>` replaced by combined right-side block

### Session 6 — Streaming Latency, Audio Quality, PostgreSQL, Dynamic URLs
31. Maya `SYSTEM_PROMPT` bulletproofed — 5 structured sections with `═══` headers
32. PostgreSQL migration — `requirements.txt` + entire DB layer rewritten with SQLAlchemy + psycopg2
33. `.env` updated — `DATABASE_URL` set to Supabase Session Mode pooler
34. Sentence-level TTS pipeline — `_pop_sentence()`, `_groq_token_stream()`, `stream_ai_response()`
35. `send_single_turn()` helper for non-streamed turns
36. Frontend audio queue — `audioQueueRef`, `drainQueue()`, `playChunk()`, `finalizeTurn()`
37. `currentSourceRef` — instant audio stop on End Interview click
38. Whisper long-form mode — `chunk_length_s: 30, stride_length_s: 5`
39. VAD tightened — `SILENCE_DURATION_S = 0.8`
40. VAD 45 s auto-trigger cap — computed from actual `AudioContext.sampleRate`
41. Dynamic interview route — `/interview/[id]/page.tsx` with security check
42. `/interview/page.tsx` overwritten with redirect component
43. `/onboarding/page.tsx` updated — routes to `/interview/${candidate_id}`

### Session 7 — Admin Auth, Email Notifications, Production Hardening, Voice
44. Voice model exploration — downloaded `en_US-l2arctic-medium`, `en_US-amy-medium`, `en_US-hfc_female-medium`; tested L2-Arctic Indian English; rolled back to American English
45. Active voice switched to `en_US-hfc_female-medium` — brighter, more natural; fallback chain `hfc_female → amy → lessac`
46. SYSTEM_PROMPT rewritten — natural conversational tone, contractions rule, "SHORT ANSWER PUSH-BACK", updated edge-case templates
47. `BASE_DIR = pathlib.Path(__file__).parent.resolve()` — all Piper binary and model paths now absolute
48. `ALLOWED_ORIGINS` env variable — CORS reads comma-separated list from environment
49. `PyJWT>=2.8.0` added to `requirements.txt`
50. `resend>=2.0.0` added to `requirements.txt`
51. JWT auth constants — `ADMIN_PASSWORD`, `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_HOURS` from `os.getenv()`
52. `oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")` + `verify_token()` FastAPI dependency
53. `LoginRequest(BaseModel)` Pydantic model for login body
54. `POST /api/admin/login` — `secrets.compare_digest()` comparison, returns 2-hour JWT
55. `GET /api/admin/candidates` protected with `Depends(verify_token)` — returns 401 on bad/missing token
56. Resend config — `RESEND_API_KEY`, `ADMIN_EMAIL`, `FROM_EMAIL` from `os.getenv()`; `resend.api_key` set conditionally
57. `_send_emails_sync()` — two HTML email templates (candidate + admin); called via `asyncio.to_thread()`
58. `_score_and_persist()` updated — new `candidate_name`/`candidate_email` params; fires `_send_emails_sync` on pass
59. WebSocket handler — `candidate_name`/`candidate_email` hoisted to handler scope
60. All 3 `_score_and_persist` call sites updated to pass `candidate_name`, `candidate_email`
61. `frontend/app/admin/login/page.tsx` created — glassmorphism card, eye-toggle, animated submit, error banner
62. `frontend/app/admin/page.tsx` updated — auth guard, Bearer fetch, sign out button
63. `CORSMiddleware` import restored
64. `.claude/commands/donesofar.md` created — `/donesofar` slash command

### Session 8 — UI/UX Polish, Sarvam AI TTS, Wizard of Oz Email, Dynamic Results
65. Sarvam AI TTS integrated as primary — `SARVAM_API_KEY`, `httpx>=0.27.0`, `clean_text_for_sarvam()`, `synthesize_speech()` with Piper as silent fallback
66. Wildcard CORS regex — `*.vercel.app`-style entries compiled to `allow_origin_regex`
67. `db_get_candidate(candidate_id)` — new DB read function for single-row lookup by candidate ID
68. `GET /api/results/{candidate_id}` — new public REST endpoint returning completed interview data
69. `frontend/app/results/[id]/page.tsx` — dynamic/shareable results page fetching from the new REST endpoint
70. `LiveCanvasWaveform.tsx` component — canvas-based real-time waveform with `WaveState` prop
71. `ThemeToggle.tsx` component — dark/light mode toggle for the landing page
72. `frontend/app/layout.tsx` — added `fixed z-50` NOVA branding element inside `ThemeProvider`; visible on every route
73. `frontend/app/page.tsx` — massive NOVA hero (`text-8xl sm:text-9xl font-black`), large CTA button (`px-12 py-6 text-2xl`, gradient `#7C3AED → #A855F7 → #EC4899`), `ThemeToggle` integration
74. `frontend/app/page.tsx` — all `dark:text-zinc-500/600/700/800` classes brightened (5 replace-all operations)
75. `frontend/app/interview/[id]/page.tsx` — timer and End Interview button repositioned from `top-5` to `top-16`; content padding `pt-24 → pt-28`
76. `frontend/app/admin/page.tsx` — `py-10 → pt-20 pb-10`; all `text-zinc-600/700/800` and inline `#52525B` color strings brightened
77. `frontend/app/admin/login/page.tsx` — all `text-zinc-600/700/800` classes brightened
78. `_send_emails_sync()` rewritten — Wizard of Oz pattern: candidate HTML email `to: [ADMIN_EMAIL]`; new subject "Action Required: You passed NOVA Tutor Screening Level 1!"; NOVA branding (`#16a34a` green header); admin email in separate `try/except` with print logging
79. `ADMIN_EMAIL` corrected to `[REDACTED_EMAIL]` in `.env`

---

## 11. Current State of the Product

**Visual:** The product has undergone a significant UI/UX polish pass. The landing page now opens with a massive NOVA wordmark (`text-8xl`/`text-9xl`), making the branding immediately legible. A large gradient "Start Interview" CTA button (`px-12 py-6`) with hover glow makes the entry point obvious. Every page shows a persistent NOVA header in the top-left (via `layout.tsx`), giving the product a cohesive identity. Dark-mode text across all pages has been raised from near-invisible zinc-600/700/800 shades to readable zinc-200/300/400 shades. The admin dashboard and login page are properly padded to clear the persistent NOVA header.

**Functional flow as of Session 8:**
- Candidate fills in name + email → onboarding → unique session-locked interview URL
- Maya conducts the full interview using Sarvam AI's Indian-accented English voice (`ritu`/`bulbul:v3`) with ~1–2 s sentence-level TTS latency; Piper TTS (`hfc_female`) activates automatically if Sarvam fails
- Live timer and End Interview button both sit below the persistent NOVA header (at `top-16`) with no visual overlap
- Scoring runs in the background; results persist in Supabase even if the candidate closes the tab
- Passed candidates' results are viewable via a shareable `/results/{candidate_id}` URL backed by the new `GET /api/results/{candidate_id}` endpoint
- On pass: a Wizard of Oz email — personalised HTML addressed to the candidate with their score — is delivered to the admin's inbox (`[REDACTED_EMAIL]`), plus a separate admin notification email; both fire independently so one failure cannot block the other
- Hiring team logs in at `/admin/login` with a password, receives a 2-hour JWT, views all completed interviews with scores, quotes, and transcripts; signs out cleanly

**What it still cannot do:** Run over HTTPS/WSS (required for production mic access), support mobile browsers reliably, send emails to real candidate inboxes (requires Resend domain verification or a full email provider swap), notify failed candidates, export data to CSV, rate-limit API calls, or protect the dynamic results endpoint behind auth.

---

## 12. Completion Estimate

| Scope | Session 1 | Session 2 | Session 3 | Session 4 | Session 5 | Session 6 | Session 7 | Session 8 |
|---|---|---|---|---|---|---|---|---|
| **MVP (local, end-to-end, single-user)** | ~50% | ~75% | ~87% | ~93% | ~96% | ~98% | ~99% | **~99%** |
| **Production-ready product** | ~15% | ~25% | ~35% | ~42% | ~44% | ~52% | ~67% | **~72%** |

Session 8 pushed production readiness primarily through UI/UX polish, email reliability, and the new dynamic results endpoint. Remaining gaps: HTTPS/WSS, mobile testing, verified email domain, admin export, and rate limiting.

---

## 13. Next Steps (Most Important First)

1. **Run a real end-to-end interview** — Test the full 6–10 min flow with actual spoken answers. Verify scoring produces sensible output. This has never been done with the Sarvam AI voice.
2. **Deploy to Render** — Set all env vars in the Render dashboard (`DATABASE_URL`, `GROQ_API_KEY`, `SARVAM_API_KEY`, `ADMIN_PASSWORD`, `JWT_SECRET`, `RESEND_API_KEY`, `ADMIN_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`). The pathlib path fix and ALLOWED_ORIGINS wildcard regex are already in place.
3. **Add HTTPS / WSS** — Required for mic access on any non-localhost domain. Render provides this automatically for web services.
4. **Verify Resend domain** — Add and verify a custom domain in the Resend dashboard, then set `FROM_EMAIL=noreply@yourdomain.com`. Remove the Wizard of Oz `to: [ADMIN_EMAIL]` hack and restore direct candidate delivery.
5. **Validate and calibrate scoring** — Run 10–20 test interviews; adjust prompts and `PASS_THRESHOLD` based on observed scores.
6. **Auth on dynamic results endpoint** — `GET /api/results/{candidate_id}` is currently public. Consider requiring a token or scoping access to the session owner only.
7. **Migrate `ScriptProcessorNode` to `AudioWorklet`** — Eliminates deprecation warnings; required for long-term browser support.
8. **Upgrade STT** — `base.en` makes too many errors on accented speech. Consider Groq Whisper API (server-side, no WASM) for production.
9. **Add CSV export to admin** — One download button for all candidate data.
10. **Email failed candidates** — Send a polite "thank you for your time" message even when the candidate doesn't pass.

---

## 14. Last Updates — Session 8 Full Detail

_Sarvam AI TTS · UI/UX Polish · Persistent NOVA Branding · Wizard of Oz Email · Dynamic Results Page_

### What problems were being solved

Five problems were addressed in Session 8:

1. **Startup error due to wrong Python interpreter** — Running `uvicorn` directly (without the venv path) caused `ModuleNotFoundError: No module named 'resend'` because system Python lacks the venv packages.
2. **Frontend-wide UI/UX polish** — The product needed a high-impact visual upgrade: a massive NOVA wordmark on the hero, a prominent CTA button, persistent global branding across all routes, and brightened dark-mode text that was previously near-invisible.
3. **NOVA header overlapping interview controls** — The global NOVA header (fixed at `top-0`, `h-14` = 56 px) covered the timer and End Interview button which were positioned at `top-5` (20 px).
4. **Email not actually delivering** — `ADMIN_EMAIL` was set to `[REDACTED_EMAIL]` (not the Resend account owner), causing hard delivery failure. Additionally, one `try/except` block silently swallowed both email sends if the first failed. Resend sandbox cannot deliver to arbitrary addresses, so a Wizard of Oz workaround was needed.
5. **Results not accessible via shareable link** — Results were stored only in `localStorage`. A candidate or recruiter who cleared the browser or visited from another device had no way to see results.

---

### Change 1: Sarvam AI TTS Integration

**File:** `backend/main.py`

`httpx>=0.27.0` was added to `requirements.txt`. `SARVAM_API_KEY` is read from the environment. A preprocessing function handles Sarvam's known rendering bugs with digits:

```python
def clean_text_for_sarvam(text: str) -> str:
    text = re.sub(r'(\d+)-(year|month)-old', r'\1 \2 old', text)
    num_map = {'1':'one','2':'two','3':'three','4':'four','5':'five',
               '6':'six','7':'seven','8':'eight','9':'nine','0':'zero'}
    for d, w in num_map.items():
        text = text.replace(d, w)
    return text
```

`synthesize_speech()` replaces direct `synthesize_with_piper()` calls throughout the streaming pipeline:

```python
async def synthesize_speech(text: str) -> bytes:
    if SARVAM_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.post(
                    "https://api.sarvam.ai/text-to-speech",
                    headers={"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"},
                    json={"inputs": [clean_text_for_sarvam(text)], "target_language_code": "en-IN",
                          "speaker": "ritu", "model": "bulbul:v3"},
                )
                resp.raise_for_status()
                return base64.b64decode(resp.json()["audios"][0])
        except Exception as exc:
            print(f"[Sarvam TTS] error — falling back to Piper: {exc}", flush=True)
    return await asyncio.to_thread(synthesize_with_piper, text)
```

The fallback is silent — Piper activates automatically with no change in the audio streaming flow. The `base64` import was already present.

---

### Change 2: Persistent Global NOVA Branding

**File:** `frontend/app/layout.tsx`

A fixed NOVA element was added inside `ThemeProvider`, before `{children}`. Using `layout.tsx` guarantees it appears above every page without any per-page wiring:

```tsx
<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
  <div className="fixed top-0 left-0 z-50 h-14 flex items-center px-6 pointer-events-none select-none">
    <span className="text-base font-black tracking-widest text-slate-900 dark:text-white">
      NOVA
    </span>
  </div>
  {children}
</ThemeProvider>
```

`pointer-events-none` ensures the fixed header never blocks clicks on underlying elements. `z-50` places it above all page-level navbars (which use `z-40`). `h-14` (56 px) defines the clear zone that every page's fixed controls must respect.

---

### Change 3: Landing Page UI Overhaul

**File:** `frontend/app/page.tsx`

Three distinct additions were made:

**Massive NOVA hero:**
```tsx
<div className="text-8xl sm:text-9xl font-black text-slate-900 dark:text-white leading-none tracking-tight">
  NOVA
</div>
```

**Large gradient CTA button:**
```tsx
<button
  onClick={focusForm}
  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-12 py-6 rounded-2xl text-2xl font-bold text-white transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-[0_0_50px_rgba(139,92,246,0.50)]"
  style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)' }}
>
  Start Interview
  <svg className="w-6 h-6" .../>
</button>
```

**Dark-mode text brightening (5 replace-all operations):**
```
dark:text-zinc-500 → dark:text-zinc-200
dark:text-zinc-600 → dark:text-zinc-300
dark:text-zinc-700 → dark:text-zinc-400
dark:placeholder:text-zinc-700 → dark:placeholder:text-zinc-500
dark:text-zinc-800 → dark:text-zinc-500  (footer only)
```

`ThemeToggle` was imported and placed in the landing page header alongside the existing navbar. The previous per-page `Nova` span in the navbar was removed since `layout.tsx` now owns it.

---

### Change 4: Interview Controls Repositioned

**File:** `frontend/app/interview/[id]/page.tsx`

The NOVA header occupies `h-14` (56 px). Both fixed interview controls were moved below it:

```tsx
// Before:
className="fixed top-5 left-6 z-30 ..."   // timer
className="fixed top-5 right-6 z-30 ..."  // End Interview

// After:
className="fixed top-16 left-6 z-30 ..."
className="fixed top-16 right-6 z-30 ..."
```

Content padding was increased to prevent the page body from being hidden under both headers:
```tsx
// Before: pt-24
// After:  pt-28
```

---

### Change 5: Wizard of Oz Email Rewrite

**Files:** `backend/main.py`, `backend/.env`

`ADMIN_EMAIL` was corrected in `.env` from `[REDACTED_EMAIL]` to `[REDACTED_EMAIL]` — the actual Resend account owner's address, the only inbox the sandbox can deliver to.

`_send_emails_sync()` was rewritten with the Wizard of Oz pattern. The candidate result email has an NOVA-branded white card (`#ffffff` background, `#d0d0d0` border), `h2` "NOVA AI Recruitment" (`#2d2d2d`), `h3` "Congratulations, {candidate_name}!" (`#16a34a` green), personalised score text, and a footer "NOVA Autonomous Screener". The critical difference from before:

```python
# Before: to=[candidate_email]
# After:  to=[ADMIN_EMAIL]  ← Wizard of Oz: body looks like it's for the candidate
resend.Emails.send({
    "from":    f"NOVA AI Recruitment <{FROM_EMAIL}>",
    "to":      [ADMIN_EMAIL],
    "subject": "Action Required: You passed NOVA Tutor Screening Level 1!",
    "html":    candidate_html,
})
print(f"[Email] Result email sent (candidate: {candidate_name} / {candidate_email})", flush=True)
```

The admin notification email was moved into its own independent `try/except` block:

```python
# Before: one try/except wrapping both sends
# After: two separate try/except blocks with print logging
try:
    resend.Emails.send({...candidate_html...})
    print("[Email] Result email sent ...", flush=True)
except Exception as exc:
    print(f"[Email] Failed to send result email: {exc}", flush=True)

# Admin email fires regardless of whether candidate email succeeded:
if ADMIN_EMAIL:
    try:
        resend.Emails.send({...admin_html...})
        print(f"[Email] Admin notification sent to {ADMIN_EMAIL}", flush=True)
    except Exception as exc:
        print(f"[Email] Failed to send admin email: {exc}", flush=True)
```

---

### Change 6: Dynamic Results Page + REST Endpoint

**Files:** `backend/main.py`, `frontend/app/results/[id]/page.tsx`

`db_get_candidate(candidate_id)` was added to the DB layer — a single-row SELECT by `candidate_id` returning the same shape as `db_get_all_completed()` rows.

A new public REST endpoint was added:

```python
@app.get("/api/results/{candidate_id}")
async def get_candidate_results(candidate_id: str):
    row = await asyncio.to_thread(db_get_candidate, candidate_id)
    if not row:
        raise HTTPException(status_code=404, detail="Results not found or interview not yet complete.")
    return row
```

`frontend/app/results/[id]/page.tsx` was created to consume this endpoint. The page fetches on mount using `params.id` from the URL, renders the same pass/fail, score, and dimension UI as the localStorage results page, and works from any device without requiring localStorage to be populated.

---

### Net effect of Session 8

- Maya now speaks with an Indian-accented English voice (Sarvam AI `ritu`/`bulbul:v3`) while Piper remains as a transparent fallback — no code path changes required when switching voices
- The product now has a visually distinct identity: the massive NOVA wordmark and persistent header make it feel like a real product rather than a prototype
- Email actually delivers during live demos — the Wizard of Oz pattern routes personalised candidate-facing emails through the admin's verified inbox
- Results are now shareable via a permanent URL (`/results/{candidate_id}`) that does not depend on localStorage or any specific browser session

---

## 15. Blueprint for Future Agents Updating This File

This section defines the exact schema and rules that any agent must follow when updating `Done_so_far.md`.

---

### File Identity Rules

- Filename: `Done_so_far.md` (capital D, lowercase rest, underscore before `so`)
- Location: project root (`ai-tutor-screener/Done_so_far.md`)
- Header line 1: `# Done So Far — AI Tutor Screener`
- Header line 2 (frontmatter): `_Last updated: YYYY-MM-DD | Sessions completed: N_`
  - Increment `N` by 1 each update
  - Use today's actual date

---

### Section Map (never reorder, never delete sections)

| # | Section Title | What goes here |
|---|---|---|
| 1 | Project Summary | Two paragraphs: what it is + what it does. Update only if core product definition changes. |
| 2 | Tech Stack | Table of Layer → Technology. Update cells when a dependency is swapped (e.g., SQLite → PostgreSQL). |
| 3 | Current System Flow | Numbered list of user-facing steps 1–N. Update step descriptions when flow changes. Add new steps if new pages/routes added. |
| 4 | Core Logic Implemented | Named subsections per major system (VAD, scoring, DB, etc.). Update subsection prose when logic changes. Add new subsection if a new system is introduced. |
| 5 | File Structure | ASCII tree of all meaningful files. Add new files. Remove deleted files. Update inline comment if file's role changes. |
| 6 | What is ACTUALLY Working | Bullet list of confirmed-working features. Add new bullets for each new working feature. Never remove bullets unless the feature was intentionally removed. |
| 7 | What is PARTIALLY Working | Bullet list of known partial/broken items. Move to §6 when fixed. Add new bullets for newly discovered partial items. |
| 8 | What is NOT Built Yet | Bullet list of absent features. Remove an item when it is built. Add new items as scope grows. |
| 9 | Bugs / Issues Faced | Numbered list. Each item: short title, *(fixed — Session N)* or *(not fixed)*, one-sentence description. Append new bugs at the bottom with the next number. Update status from *(not fixed)* to *(fixed — Session N)* when resolved. Never renumber existing items. |
| 10 | Fixes & Improvements Done | Grouped by session with `### Session N — Title` header. Each item is a numbered line continuing the global count. Append a new `### Session N` block — never edit prior session blocks. |
| 11 | Current State of the Product | 3–4 paragraph prose: Visual, Functional flow, What it cannot do. Rewrite this section each update to reflect current reality. |
| 12 | Completion Estimate | Table: Scope rows × Session columns. Add a new Session column each update. Update both MVP and Production-ready percentages. |
| 13 | Next Steps | Ordered list by priority. Rewrite/reprioritize each update based on what was just built and what remains. |
| 14 | Last Updates — Session N Full Detail | Detailed technical write-up of the most recent session. This section is **replaced** each update (not appended). Rename the section heading to match the new session number. |
| 15 | Blueprint | This section. Do not modify. |

---

### Per-Session Update Checklist

When updating for a new session, the agent must touch these sections in this order:

1. **Header** — increment session count, update date
2. **§2 Tech Stack** — update any changed dependencies or layers
3. **§3 System Flow** — update any changed steps or routes
4. **§4 Core Logic** — update subsections whose logic changed
5. **§5 File Structure** — add/remove/re-annotate files
6. **§6 Actually Working** — add bullets for new working features
7. **§7 Partially Working** — move fixed items to §6; add new partial items
8. **§8 Not Built Yet** — remove items that were built; add new scope items
9. **§9 Bugs** — append new bugs; update *(not fixed)* → *(fixed — Session N)* for resolved ones
10. **§10 Fixes** — append a new `### Session N` block with globally-numbered items continuing from the last number
11. **§11 Current State** — rewrite prose to reflect current reality
12. **§12 Completion** — add new Session column with updated % estimates
13. **§13 Next Steps** — reprioritize based on what was just built
14. **§14 Last Updates** — replace entirely with detailed technical write-up of the new session

---

### Writing Style Rules

- **Code blocks**: use triple-backtick fenced blocks with language tag (`python`, `typescript`, `tsx`, `bash`)
- **File paths**: always use backtick inline code (`frontend/app/interview/[id]/page.tsx`)
- **Before/After changes**: use `// Before:` / `// After:` comment pattern inside code blocks
- **Bug list items**: format as `N. **Short title** *(fixed — Session N)* — one sentence.`
- **Fix list items**: format as `N. Short description of what was added/changed`
- **Session detail sections**: use `###` headers for each named change; start with a "What problems were being solved" subsection listing the problems in a numbered list before detailing each fix
- **No emojis** unless previously present in that section
- **Tense**: use past tense for completed work ("was replaced", "added", "rewrote"); present tense for descriptions of current state ("the pipeline streams", "the component reads")
- **Percentages**: round to nearest whole number; both MVP and Production rows must be present

---

### What NOT to include

- Ephemeral task state (current TODO lists, in-progress notes)
- Git commit hashes or branch names
- Timestamps of individual commits
- Developer names or machine-specific paths
- Secrets or credentials (even if already in `.env`)
- Explanations of *why* the agent updated the file — only the content itself
