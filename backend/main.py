import asyncio
import base64
import json
import os
import pathlib
import random
import re
import secrets
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

import jwt
import resend
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from groq import Groq
from pydantic import BaseModel
from sqlalchemy import create_engine, text

# load_dotenv is a no-op when .env is absent (production), so this is safe.
load_dotenv()

app = FastAPI(title="AI Tutor Screener API")

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Convert wildcard entries like "*.vercel.app" into a regex for allow_origin_regex.
# Explicit origins (no wildcard) go into allow_origins as-is.
_regex_parts: list[str] = []
for _o in ALLOWED_ORIGINS:
    if _o.startswith("*."):
        # *.vercel.app  →  https://[^/]+\.vercel\.app
        _regex_parts.append(r"https://[^/]+" + re.escape(_o[1:]))
_ORIGIN_REGEX: str | None = "|".join(_regex_parts) or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if not o.startswith("*.")],
    allow_origin_regex=_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client   = Groq(api_key=os.getenv("GROQ_API_KEY"))
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")

# Persistent HTTP client — reuses TLS connections across Sarvam TTS calls.
_http_client = httpx.AsyncClient(
    limits=httpx.Limits(max_keepalive_connections=5),
    timeout=12.0,
)

# Pre-baked filler audio bytes, populated at startup by _prebake_fillers().
_FILLER_TEXTS = ["Hmm.", "Interesting.", "I see."]
_filler_audio: dict[str, bytes] = {}


def clean_text_for_sarvam(text: str) -> str:
    text = re.sub(r'(\d+)-(year|month)-old', r'\1 \2 old', text)
    num_map = {'1':'one','2':'two','3':'three','4':'four','5':'five',
               '6':'six','7':'seven','8':'eight','9':'nine','0':'zero'}
    for d, w in num_map.items():
        text = text.replace(d, w)
    return text

# ─── PostgreSQL Database (Supabase) ───────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_engine():
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. "
            "Add it to your .env file as: DATABASE_URL=postgresql://..."
        )
    # Supabase (and Heroku) sometimes emit postgres:// — SQLAlchemy 2.x requires postgresql://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    return create_engine(
        db_url,
        # pool_pre_ping re-validates each connection before handing it out.
        # This prevents "SSL connection has been closed unexpectedly" crashes
        # on free hosting tiers that drop idle connections after ~60 s.
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


_engine = _make_engine()


def init_db() -> None:
    with _engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS candidates (
                candidate_id    TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                email           TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                transcript_json TEXT,
                scores_json     TEXT,
                passed          INTEGER,
                overall_score   DOUBLE PRECISION,
                completed_at    TEXT
            )
        """))


def db_save_candidate(candidate_id: str, name: str, email: str) -> None:
    with _engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO candidates (candidate_id, name, email, created_at)
                VALUES (:candidate_id, :name, :email, :created_at)
                ON CONFLICT (candidate_id) DO NOTHING
            """),
            {
                "candidate_id": candidate_id,
                "name":         name,
                "email":        email.lower().strip(),
                "created_at":   _now_iso(),
            },
        )


def db_check_email_completed(email: str) -> bool:
    """Return True if this email already has a completed interview row."""
    with _engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT 1 FROM candidates
                WHERE email = :email AND completed_at IS NOT NULL
                LIMIT 1
            """),
            {"email": email.lower().strip()},
        ).fetchone()
        return row is not None


def db_get_all_completed() -> list[dict]:
    """Return all completed interviews, newest first."""
    with _engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT candidate_id, name, email, overall_score, passed,
                       completed_at, created_at, scores_json, transcript_json
                FROM   candidates
                WHERE  completed_at IS NOT NULL
                ORDER  BY completed_at DESC
            """)
        ).mappings().all()

    result = []
    for row in rows:
        d = dict(row)
        try:
            d["scores"] = json.loads(d.pop("scores_json") or "{}")
        except Exception:
            d["scores"] = {}
        try:
            d["transcript"] = json.loads(d.pop("transcript_json") or "[]")
        except Exception:
            d["transcript"] = []
        d["passed"] = bool(d["passed"])
        result.append(d)
    return result


def db_get_candidate(candidate_id: str) -> dict | None:
    """Return a single completed interview by candidate_id, or None."""
    with _engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT candidate_id, name, email, overall_score, passed,
                       completed_at, created_at, scores_json, transcript_json
                FROM   candidates
                WHERE  candidate_id = :candidate_id AND completed_at IS NOT NULL
                LIMIT  1
            """),
            {"candidate_id": candidate_id},
        ).mappings().fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["scores"] = json.loads(d.pop("scores_json") or "{}")
    except Exception:
        d["scores"] = {}
    try:
        d["transcript"] = json.loads(d.pop("transcript_json") or "[]")
    except Exception:
        d["transcript"] = []
    d["passed"] = bool(d["passed"])
    return d


def db_update_results(candidate_id: str, conversation: list[dict], results: dict) -> None:
    with _engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE candidates
                SET transcript_json = :transcript,
                    scores_json     = :scores,
                    passed          = :passed,
                    overall_score   = :overall_score,
                    completed_at    = :completed_at
                WHERE candidate_id  = :candidate_id
            """),
            {
                "transcript":    json.dumps(conversation),
                "scores":        json.dumps(results),
                "passed":        1 if results.get("passed") else 0,
                "overall_score": results.get("overall_score"),
                "completed_at":  _now_iso(),
                "candidate_id":  candidate_id,
            },
        )


# Initialise the DB at startup (synchronous — runs before any requests are served)
init_db()


# pathlib guarantees correct resolution regardless of the working directory
# Render (and other hosts) may start uvicorn from /, not from the project root.
BASE_DIR      = pathlib.Path(__file__).parent.resolve()
PIPER_BIN     = str(BASE_DIR / "piper" / "piper")
_HFC_MODEL    = BASE_DIR / "models" / "en_US-hfc_female-medium.onnx"
_AMY_MODEL    = BASE_DIR / "models" / "en_US-amy-medium.onnx"
_LESSAC_MODEL = BASE_DIR / "models" / "en_US-lessac-medium.onnx"
if _HFC_MODEL.exists():
    PIPER_MODEL_PATH = str(_HFC_MODEL)
elif _AMY_MODEL.exists():
    PIPER_MODEL_PATH = str(_AMY_MODEL)
else:
    PIPER_MODEL_PATH = str(_LESSAC_MODEL)

# ─── Admin Auth ───────────────────────────────────────────────────────────────

ADMIN_PASSWORD  = os.getenv("ADMIN_PASSWORD", "")
JWT_SECRET      = os.getenv("JWT_SECRET", "changeme-replace-in-production")
JWT_ALGORITHM   = "HS256"
JWT_EXPIRE_HOURS = 2

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")


def verify_token(token: str = Depends(oauth2_scheme)) -> None:
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


class LoginRequest(BaseModel):
    password: str


# ─── Email (Resend) ───────────────────────────────────────────────────────────

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
ADMIN_EMAIL    = os.getenv("ADMIN_EMAIL", "")
FROM_EMAIL     = os.getenv("FROM_EMAIL", "onboarding@resend.dev")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def _send_emails_sync(
    candidate_name: str,
    candidate_email: str,
    candidate_id: str,
    overall_score: float,
) -> None:
    """Synchronous helper — called via asyncio.to_thread so it never blocks the event loop."""
    if not RESEND_API_KEY:
        print("[Email] RESEND_API_KEY not configured — skipping.", flush=True)
        return

    score_display = f"{overall_score:.1f}"
    first_name    = candidate_name.split()[0] if candidate_name else "there"

    # ── Candidate result email (Wizard of Oz demo) ───────────────────────────
    # Visually addressed to the candidate but delivered to ADMIN_EMAIL so it
    # reaches the inbox during live demos without a verified sending domain.
    candidate_html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NOVA Tutor Screening Result</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #d0d0d0;max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="padding:32px 40px 20px;">
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#2d2d2d;letter-spacing:-0.3px;">NOVA AI Recruitment</h2>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e8e8e8;margin:0;" /></td></tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 40px 24px;">
            <h3 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#16a34a;">
              Congratulations, {candidate_name}!
            </h3>
            <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.7;">
              You have successfully passed the NOVA Tutor Screening - Level 1 with an exceptional score of <strong>{score_display}/5.0</strong>.
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.7;">
              Our AI engine was highly impressed with your technical communication and clarity. Someone from our human recruitment team will contact you shortly with the next steps.
            </p>
            <p style="margin:0;font-size:15px;color:#444444;line-height:1.7;">
              <strong>Next Steps:</strong> Keep an eye on your email (and spam folder) for scheduling your final technical round.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px;border-top:1px solid #e8e8e8;">
            <p style="margin:0;font-size:11px;color:#999999;line-height:1.6;">
              This is an automated message from the NOVA Autonomous Screener. Please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""
    try:
        resend.Emails.send({
            "from":    f"NOVA AI Recruitment <{FROM_EMAIL}>",
            "to":      [ADMIN_EMAIL],
            "subject": "Action Required: You passed NOVA Tutor Screening Level 1!",
            "html":    candidate_html,
        })
        print(f"[Email] Result email sent (candidate: {candidate_name} / {candidate_email})", flush=True)
    except Exception as exc:
        print(f"[Email] Failed to send result email: {exc}", flush=True)

    # ── Admin notification email ──────────────────────────────────────────────
    if ADMIN_EMAIL:
        admin_html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Candidate Passed</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FFFDF9;border-radius:20px;overflow:hidden;border:1px solid #EDE8E0;max-width:560px;width:100%;">

        <!-- Header band -->
        <tr>
          <td style="background:#2C2825;padding:24px 40px;text-align:center;">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:0.1em;text-transform:uppercase;">Cuemath Recruiter Alert</p>
            <h1 style="margin:6px 0 0;font-size:22px;font-weight:600;color:#ffffff;">New Candidate Passed</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px 24px;">

            <!-- Candidate summary card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border-radius:12px;border:1px solid #EDE8E0;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 2px;font-size:18px;font-weight:600;color:#2C2825;">{candidate_name or 'Unknown'}</p>
                        <p style="margin:0;font-size:13px;color:#8B7D72;">{candidate_email or '—'}</p>
                      </td>
                      <td align="right" style="vertical-align:top;">
                        <span style="display:inline-block;background:#e8f5f0;color:#7A9E8E;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.05em;">PASS</span>
                      </td>
                    </tr>
                  </table>

                  <hr style="border:none;border-top:1px solid #EDE8E0;margin:16px 0;" />

                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:50%;">
                        <p style="margin:0 0 2px;font-size:10px;color:#B8AFA8;text-transform:uppercase;letter-spacing:0.07em;">Score</p>
                        <p style="margin:0;font-size:22px;font-weight:700;color:#C9986A;">{score_display}<span style="font-size:13px;color:#B8AFA8;font-weight:400;"> / 5.0</span></p>
                      </td>
                      <td style="width:50%;">
                        <p style="margin:0 0 2px;font-size:10px;color:#B8AFA8;text-transform:uppercase;letter-spacing:0.07em;">Session ID</p>
                        <p style="margin:0;font-size:11px;color:#4A4240;font-family:monospace;word-break:break-all;">{candidate_id}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:14px;color:#4A4240;line-height:1.7;">
              This candidate has been automatically emailed with their result and told that someone from
              the team will be in touch shortly.
            </p>
            <p style="margin:0;font-size:14px;color:#4A4240;line-height:1.7;">
              Log in to the admin dashboard to view their full transcript, dimension scores, and quote evidence.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px;border-top:1px solid #EDE8E0;">
            <p style="margin:0;font-size:12px;color:#B8AFA8;text-align:center;line-height:1.6;">
              Cuemath AI Screener · Automated Talent Notification
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        try:
            resend.Emails.send({
                "from":    f"Cuemath AI Screener <{FROM_EMAIL}>",
                "to":      [ADMIN_EMAIL],
                "subject": f"[Passed] {candidate_name or 'Candidate'} scored {score_display}/5.0",
                "html":    admin_html,
            })
            print(f"[Email] Admin notification sent to {ADMIN_EMAIL}", flush=True)
        except Exception as exc:
            print(f"[Email] Failed to send admin email to {ADMIN_EMAIL}: {exc}", flush=True)

SYSTEM_PROMPT = """You are Maya, a warm, upbeat, and professional recruiter at Cuemath conducting a voice screening interview.

═══════════════════════════════════════════════
SECTION 1 — YOUR IDENTITY & SOLE OBJECTIVE
═══════════════════════════════════════════════

You are assessing ONE thing only: soft skills. You are NOT testing mathematics knowledge.
The five dimensions you must evaluate are:
  1. Communication Clarity  — Can they explain math simply enough for a child?
  2. Warmth & Empathy       — Do they notice and respond to a child's emotional state?
  3. Patience & Composure   — Can they stay calm when a child is frustrated or slow?
  4. Adaptability           — Do they change their approach when one method fails?
  5. English Fluency        — Natural, clear, grammatically comfortable spoken English.

Voice & style rules (NEVER break these):
  - You are on a voice call. Sound like a real, friendly American woman having a conversation — not a robot reading a script.
  - Use casual, natural contractions: "you'd", "let's", "that's", "I'd love to", "totally".
  - Keep energy warm and encouraging throughout, like a supportive colleague — not formal, not stiff.
  - NEVER use bullet points, numbered lists, markdown, or headers in your spoken responses.
  - NEVER evaluate or judge the candidate out loud. Stay curious and encouraging.
  - Always briefly acknowledge what the candidate just said before moving on.
    Good: "Oh I love that instinct, that's really thoughtful."
    Bad: Jumping straight to the next question without acknowledging the previous answer.
  - Keep every response to 2–4 sentences maximum. This is a voice call, not an essay.
  - Never sound sultry, slow, or overly smooth. Stay bright and conversational.

═══════════════════════════════════════════════
SECTION 2 — QUESTIONING STYLE (STRICTLY ENFORCED)
═══════════════════════════════════════════════

RULE: You must NEVER ask a generic interview question. Every single question must drop the candidate into a specific situation or ask them to recall a specific real moment.

Generic questions are PERMANENTLY BANNED. Never say:
  ✗ "What is your teaching philosophy?"
  ✗ "How do you handle difficult students?"
  ✗ "What are your strengths or weaknesses as a tutor?"
  ✗ "Tell me about yourself."
  ✗ "Why do you want to work at Cuemath?"
  ✗ "Where do you see yourself in five years?"
  ✗ Any yes/no question.

EVERY question must be TYPE A or TYPE B:

TYPE A — SITUATIONAL ROLEPLAY:
Drop the candidate into a live scenario. Often you play the role of a confused or upset child yourself.
Examples:
  → "Okay so imagine I'm a 9-year-old and I just told you I hate math because I don't get fractions at all. How would you explain to me what a fraction actually is — like right now, talking to me?"
  → "Pretend I'm your student and I've been staring at the same problem for ten minutes and I'm about to cry. What's the very first thing you say to me?"
  → "I'm a 7-year-old and I just said fractions are stupid and I give up. What do you say to me?"
  → "You're in the middle of a lesson and I suddenly just zone out and start looking out the window. How do you bring me back without making me feel embarrassed?"
  → "I'm your student and I just got a question wrong that we went over three times already. I look really deflated. What do you do?"

TYPE B — BEHAVIORAL PROBE:
Ask the candidate to recall a specific real moment from their experience.
Examples:
  → "You've explained a concept twice two different ways and I still have a blank stare. Walk me through your exact next move — like specifically what would you say or do?"
  → "Tell me about a specific time you could tell a student was about to give up on a problem. What did you actually do, step by step?"
  → "Think of a moment a student said or did something mid-lesson that completely surprised you. What happened and how did you handle it?"
  → "Has a student ever pushed back on something you were teaching, like said 'this doesn't make sense'? What did you do?"

Cover all 5 dimensions across 5–7 questions total. Let the conversation flow naturally — one strong question can reveal multiple dimensions at once.

═══════════════════════════════════════════════
SECTION 3 — DYNAMIC FOLLOW-UPS (THE ADAPTABILITY RULE)
═══════════════════════════════════════════════

Listen carefully to every answer. Adapt. You are not reading from a script.

JARGON DETECTION:
If the candidate uses a word or phrase a 9-year-old wouldn't understand, immediately step into character as that child and push back. Do not let jargon pass.
  Trigger words include (but are not limited to): "pedagogy", "scaffolding", "metacognition", "Socratic method", "constructivism", "differentiated instruction", "Bloom's taxonomy", "higher-order thinking", "growth mindset", or any unexplained advanced math terminology.
  Mandatory response template: "Oh wait — remember I'm the 9-year-old here! I have no idea what [word] means. Can you say that in a way I'd actually get?"

STRONG ANSWER:
If the answer is specific, warm, and concrete — affirm it briefly, then move to the next dimension.
  Template: "Oh that's a really lovely approach, I can picture that. Okay let me put you in another situation..."

WEAK OR VAGUE ANSWER:
If the answer is generic, abstract, or sounds like it was memorised — probe once with a concrete follow-up. Do this only once per answer.
  Template: "That totally makes sense as a general idea — but can you walk me through exactly what you'd actually say to that child in that moment? Even just a few words of what you'd tell them?"

SHORT ANSWER PUSH-BACK:
If the answer is too brief or has no concrete detail — push back warmly.
  Mandatory response: "I need just a bit more to go on — could you walk me through an example of that? Like what would you actually say or do in that moment?"

═══════════════════════════════════════════════
SECTION 4 — HARDCODED EDGE CASE HANDLING
═══════════════════════════════════════════════

These rules override everything else. Apply the moment the trigger is met.

EDGE CASE A — SHORT OR ONE-WORD ANSWER:
  Trigger: Candidate response is fewer than 15 words or contains no concrete detail whatsoever.
  Mandatory response: "I need a bit more detail to really understand your approach — could you walk me through an example? Like what would you actually say or do in that moment?"

EDGE CASE B — OFF-TOPIC RAMBLING:
  Trigger: Candidate spends more than 3–4 sentences on something unrelated to the question (their background, unrelated stories, etc.).
  Mandatory response: "I love that detail, but to keep us on track let's pivot back — how would you actually handle that specific moment with the child I described?"

EDGE CASE C — GARBLED OR INCOHERENT AUDIO:
  Trigger: Transcribed text makes no grammatical sense, contains random characters, is fewer than 4 meaningful words, or looks like a transcription error (e.g., "uh the the the", "I I I I", a single isolated word, random letters).
  Mandatory response: "I'm so sorry, the audio cut out for a second there. Could you say that last part again? I want to make sure I catch everything."
  CRITICAL: Do NOT interpret or respond to garbled text as if it were a real answer. Always use this recovery line first.

EDGE CASE D — CANDIDATE ASKS ABOUT SCORING OR HOW THEY'RE DOING:
  Trigger: Candidate asks "How am I doing?", "Did I pass?", "What are you looking for?", "Am I doing well?", or anything similar.
  Mandatory response: "I'm just here to have a real conversation with you — I'm not scoring out loud or anything like that. Just be yourself and we'll go from there."

EDGE CASE E — EXTENDED SILENCE:
  Trigger: Candidate says nothing meaningful or only filler sounds ("um", "uh", "hmm") for an extended pause.
  Mandatory response: "No rush at all — take all the time you need. I'm right here whenever you're ready."

═══════════════════════════════════════════════
SECTION 5 — INTERVIEW LIFECYCLE
═══════════════════════════════════════════════

OPENING (already delivered before this conversation — do not repeat it):
"Hi! I'm really glad you're here today. I'd love to get a real sense of how you connect with kids, so I'm going to put you in a few little scenarios — nothing scary, just real situations tutors face. Let's start: imagine I'm a 9-year-old who's been staring at a fraction problem and I'm getting really frustrated. What do you say to me first?"

DURING THE INTERVIEW:
  - Ask 5–7 questions total, covering all 5 dimensions.
  - Never ask two questions back-to-back without acknowledging the previous answer first.
  - Do not mention scores, dimensions, or evaluation criteria at any point.
  - Sound like a person, not a system. Keep it conversational, warm, and real.

WRAPPING UP:
  - After all 5 dimensions have been explored AND at least 6 minutes have passed, begin closing naturally.
  - Give a genuine, warm closing remark. Thank the candidate sincerely.
  - End your final closing response with exactly this token: [INTERVIEW_COMPLETE]
  - Do not place any text after [INTERVIEW_COMPLETE].
"""

WRAP_UP_INJECTION = (
    "You have been talking for 9 minutes. "
    "Gently wrap up: give a warm closing remark, thank the candidate sincerely, "
    "and end your response with [INTERVIEW_COMPLETE] on its own line."
)

SESSION_WARN_MINUTES  = 9.0
SESSION_FORCE_MINUTES = 10.5

DIMENSION_WEIGHTS = {
    "clarity":      0.30,
    "warmth":       0.20,
    "patience":     0.20,
    "adaptability": 0.20,
    "fluency":      0.10,
}

PASS_THRESHOLD = 3.0

QUOTE_EXTRACTION_PROMPT = """You are evaluating a tutor job screener interview.
Extract the single most revealing verbatim quote from the CANDIDATE (not the interviewer) for each dimension below.
Choose the quote that best shows their actual skill level — positive OR negative evidence counts.

Dimensions:
- clarity: ability to explain math simply to a child
- warmth: noticing and responding to a child's emotions
- patience: handling frustration without losing calm
- adaptability: changing approach when an explanation is not working
- fluency: natural, clear spoken English

Return ONLY valid JSON (no commentary) with this exact schema:
{
  "clarity": "<exact candidate quote>",
  "warmth": "<exact candidate quote>",
  "patience": "<exact candidate quote>",
  "adaptability": "<exact candidate quote>",
  "fluency": "<exact candidate quote>"
}

If no relevant quote exists for a dimension, use the string "No clear evidence provided."
"""

SCORING_PROMPT = """You are scoring a tutor job screener candidate on 5 dimensions using a 1-5 scale.

CRITICAL RULE: If the candidate gives irrelevant, completely silent, nonsensical, or near-empty answers
(e.g. only filler words, single words, random sounds, or no substantive response to any question),
you MUST score them 1/5 on every dimension and they must fail. Do not award higher scores to candidates
who have not demonstrated any teaching ability whatsoever.

Scale:
1 = Very poor — major red flag
2 = Below average — notable gap
3 = Acceptable — meets minimum bar
4 = Good — clearly above average
5 = Excellent — outstanding

Dimensions (with scoring weight):
- clarity (30%): Can they explain math simply to a child?
- warmth (20%): Do they notice and respond to a child's emotions?
- patience (20%): How do they handle frustration without losing calm?
- adaptability (20%): Do they change approach when one explanation is not landing?
- fluency (10%): Natural, clear spoken English?

For EACH dimension, perform chain-of-thought reasoning:
1. observed_behavior: Summarise in one sentence what you specifically observed in the transcript for this dimension.
2. positive_signals: Array of 1-3 concrete positive examples from what the candidate actually said. Empty array if none.
3. negative_signals: Array of 1-3 concrete gaps or red flags from what the candidate said. Empty array if none.
4. rubric_anchor: One sentence justifying exactly where on the 1-5 scale this falls and why.
5. final_score: The integer score (1-5) derived from the analysis above.

Return ONLY valid JSON (no commentary) with this exact schema:
{
  "clarity":      {"observed_behavior": "<str>", "positive_signals": ["<str>"], "negative_signals": ["<str>"], "rubric_anchor": "<str>", "final_score": <int 1-5>},
  "warmth":       {"observed_behavior": "<str>", "positive_signals": ["<str>"], "negative_signals": ["<str>"], "rubric_anchor": "<str>", "final_score": <int 1-5>},
  "patience":     {"observed_behavior": "<str>", "positive_signals": ["<str>"], "negative_signals": ["<str>"], "rubric_anchor": "<str>", "final_score": <int 1-5>},
  "adaptability": {"observed_behavior": "<str>", "positive_signals": ["<str>"], "negative_signals": ["<str>"], "rubric_anchor": "<str>", "final_score": <int 1-5>},
  "fluency":      {"observed_behavior": "<str>", "positive_signals": ["<str>"], "negative_signals": ["<str>"], "rubric_anchor": "<str>", "final_score": <int 1-5>}
}
"""


# ─── Scoring pipeline ────────────────────────────────────────────────────────

_INSUFFICIENT_REASON = "Candidate provided insufficient or no audio responses."

def _make_empty_result() -> dict:
    """Hard-fail result used when the candidate said fewer than 15 words total."""
    dimensions: dict = {}
    for dim, weight in DIMENSION_WEIGHTS.items():
        dimensions[dim] = {
            "score":             1,
            "weight":            weight,
            "quote":             "No clear evidence provided.",
            "feedback":          _INSUFFICIENT_REASON,
            "observed_behavior": _INSUFFICIENT_REASON,
            "positive_signals":  [],
            "negative_signals":  ["Candidate did not provide sufficient spoken responses."],
            "rubric_anchor":     _INSUFFICIENT_REASON,
        }
    return {"passed": False, "overall_score": 1.0, "dimensions": dimensions}


async def run_scoring_pipeline(conversation: list[dict]) -> dict:
    # Guard: count candidate words — skip Groq entirely if there's almost nothing to score.
    candidate_words = sum(
        len(m["content"].split())
        for m in conversation
        if m["role"] == "user"
    )
    if candidate_words < 15:
        return _make_empty_result()

    transcript = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'Candidate'}: {m['content']}"
        for m in conversation
    )

    # Step 1 — extract one key quote per dimension
    try:
        q_resp = await asyncio.to_thread(
            lambda: groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": QUOTE_EXTRACTION_PROMPT},
                    {"role": "user", "content": f"INTERVIEW TRANSCRIPT:\n{transcript}"},
                ],
                temperature=0.1,
                max_tokens=600,
                response_format={"type": "json_object"},
            )
        )
        quotes: dict = json.loads(q_resp.choices[0].message.content)
    except Exception:
        quotes = {d: "No clear evidence provided." for d in DIMENSION_WEIGHTS}

    # Step 2 — score each dimension
    try:
        s_resp = await asyncio.to_thread(
            lambda: groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": SCORING_PROMPT},
                    {
                        "role": "user",
                        "content": (
                            f"INTERVIEW TRANSCRIPT:\n{transcript}\n\n"
                            f"KEY QUOTES:\n{json.dumps(quotes, indent=2)}"
                        ),
                    },
                ],
                temperature=0.1,
                max_tokens=2000,
                response_format={"type": "json_object"},
            )
        )
        scores: dict = json.loads(s_resp.choices[0].message.content)
    except Exception:
        scores = {d: {"final_score": 3, "rubric_anchor": "Score unavailable.", "observed_behavior": "", "positive_signals": [], "negative_signals": []} for d in DIMENSION_WEIGHTS}

    # Combine into final structured result
    weighted_sum = 0.0
    dimensions: dict = {}
    for dim, weight in DIMENSION_WEIGHTS.items():
        raw = scores.get(dim, {})
        score = max(1, min(5, int(raw.get("final_score", raw.get("score", 3)))))
        rubric_anchor      = str(raw.get("rubric_anchor", raw.get("feedback", "")))
        observed_behavior  = str(raw.get("observed_behavior", ""))
        positive_signals   = [str(s) for s in raw.get("positive_signals", [])] if isinstance(raw.get("positive_signals"), list) else []
        negative_signals   = [str(s) for s in raw.get("negative_signals", [])] if isinstance(raw.get("negative_signals"), list) else []
        quote = str(quotes.get(dim, "No clear evidence provided."))
        weighted_sum += score * weight
        dimensions[dim] = {
            "score":             score,
            "weight":            weight,
            "quote":             quote,
            "feedback":          rubric_anchor,
            "observed_behavior": observed_behavior,
            "positive_signals":  positive_signals,
            "negative_signals":  negative_signals,
            "rubric_anchor":     rubric_anchor,
        }

    overall = round(weighted_sum, 2)
    return {
        "passed": overall >= PASS_THRESHOLD,
        "overall_score": overall,
        "dimensions": dimensions,
    }


# ─── Background scoring task (survives WebSocket disconnect) ─────────────────

async def _score_and_persist(
    candidate_id: str | None,
    conversation: list[dict],
    candidate_name: str = "",
    candidate_email: str = "",
) -> dict:
    """
    Run the two-step scoring pipeline, persist to DB, and fire email notifications.
    Runs as asyncio.create_task() so it survives WebSocket disconnects.
    """
    results = await run_scoring_pipeline(conversation)

    if candidate_id:
        try:
            await asyncio.to_thread(db_update_results, candidate_id, conversation, results)
        except Exception:
            pass

    # Send emails only when the candidate passed — wrapped so any Resend outage
    # never touches the user experience or the scoring result.
    if results.get("passed") and results.get("overall_score", 0) >= 3.0:
        try:
            await asyncio.to_thread(
                _send_emails_sync,
                candidate_name,
                candidate_email,
                candidate_id or "",
                float(results.get("overall_score", 0)),
            )
        except Exception:
            pass

    return results


# ─── TTS ──────────────────────────────────────────────────────────────────────

def synthesize_with_piper(text: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        output_path = f.name
    try:
        result = subprocess.run(
            [PIPER_BIN, "--model", PIPER_MODEL_PATH, "--output_file", output_path],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode())
        with open(output_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(output_path):
            os.unlink(output_path)


async def synthesize_speech(text: str) -> bytes:
    """
    Primary TTS: Sarvam AI (Indian accent, ritu/bulbul:v3).
    Falls back silently to local Piper if Sarvam is unavailable or returns an error.
    Uses the module-level _http_client to reuse TLS connections across calls.
    """
    if SARVAM_API_KEY:
        try:
            resp = await _http_client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={
                    "api-subscription-key": SARVAM_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [clean_text_for_sarvam(text)],
                    "target_language_code": "en-IN",
                    "speaker": "ritu",
                    "model": "bulbul:v3",
                },
            )
            resp.raise_for_status()
            audio_b64: str = resp.json()["audios"][0]
            return base64.b64decode(audio_b64)
        except Exception as exc:
            print(f"[Sarvam TTS] error — falling back to Piper: {exc}", flush=True)
    return await asyncio.to_thread(synthesize_with_piper, text)


# ─── Streaming helpers ────────────────────────────────────────────────────────

def _pop_sentence(buf: str) -> tuple[str, str]:
    """Split off the first complete sentence. Returns ('', buf) if none complete yet."""
    for i, ch in enumerate(buf):
        if ch in '.!?':
            nxt = i + 1
            if nxt >= len(buf) or buf[nxt] in (' ', '\n', '\t', '"', "'"):
                return buf[:nxt].strip(), buf[nxt:].lstrip()
    return '', buf


async def _groq_token_stream(messages: list[dict]):
    """
    Run the Groq streaming SDK call in a daemon thread and yield each token
    back to the asyncio event loop via an asyncio.Queue.
    This lets us overlap Piper TTS synthesis with token generation.
    """
    loop = asyncio.get_running_loop()
    q: asyncio.Queue[str | None] = asyncio.Queue()

    def _run() -> None:
        try:
            stream = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=messages,
                temperature=0.75,
                max_tokens=100,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        loop.call_soon_threadsafe(q.put_nowait, delta)
        except Exception:
            pass
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)  # sentinel

    threading.Thread(target=_run, daemon=True).start()

    while True:
        token = await q.get()
        if token is None:
            break
        yield token


async def stream_ai_response(
    ws: WebSocket,
    messages: list[dict],
    question_num: int,
) -> tuple[str, bool]:
    """
    Stream Groq tokens → detect sentence boundaries → synthesize each sentence
    with Piper immediately → send audio_chunk + WAV binary over WebSocket.
    The next sentence is being accumulated while the current one is being
    synthesized, cutting perceived latency to ~1-2 s for the first utterance.

    Returns (clean_full_text, is_complete).
    """
    sentence_buf = ""
    full_text    = ""
    is_first     = True

    async def _flush(sentence: str) -> None:
        nonlocal is_first
        clean = sentence.replace("[INTERVIEW_COMPLETE]", "").strip()
        if not clean:
            return
        audio_bytes = await synthesize_speech(clean)
        await ws.send_json({
            "type":     "audio_chunk",
            "sentence": clean,
            "question": question_num if is_first else None,
            "first":    is_first,
        })
        await ws.send_bytes(audio_bytes)
        is_first = False

    try:
        async for token in _groq_token_stream(messages):
            sentence_buf += token
            full_text    += token
            while True:
                sentence, remainder = _pop_sentence(sentence_buf)
                if not sentence:
                    break
                sentence_buf = remainder
                await _flush(sentence)
    except Exception:
        pass

    # Flush any trailing text (e.g. final sentence with no punctuation)
    if sentence_buf.strip():
        try:
            await _flush(sentence_buf)
        except Exception:
            pass

    full_text_clean = full_text.replace("[INTERVIEW_COMPLETE]", "").strip()

    # Fallback if Groq returned nothing at all
    if not full_text_clean:
        full_text_clean = "I'm sorry, I had a small hiccup there. Could you say that again?"
        try:
            audio_bytes = await synthesize_speech(full_text_clean)
            await ws.send_json({"type": "audio_chunk", "sentence": full_text_clean,
                                "question": question_num, "first": True})
            await ws.send_bytes(audio_bytes)
        except Exception:
            pass

    is_complete = "[INTERVIEW_COMPLETE]" in full_text
    # turn_end is the critical unblocking signal — send it even if TTS failed above.
    await ws.send_json({"type": "turn_end", "full_text": full_text_clean, "is_final": True})
    return full_text_clean, is_complete


async def send_single_turn(ws: WebSocket, text: str, question: int) -> None:
    """Synthesize and send a hardcoded string as one audio_chunk (used for the opening)."""
    audio_bytes = await synthesize_speech(text)
    await ws.send_json({"type": "audio_chunk", "sentence": text, "question": question, "first": True})
    await ws.send_bytes(audio_bytes)
    await ws.send_json({"type": "turn_end", "full_text": text, "is_final": True})


# ─── Startup: pre-bake filler audio ─────────────────────────────────────────

@app.on_event("startup")
async def _prebake_fillers() -> None:
    """Synthesize short filler clips once at startup so they can be sent instantly."""
    for text in _FILLER_TEXTS:
        try:
            _filler_audio[text] = await synthesize_speech(text)
            print(f"[Startup] Pre-baked filler: {text!r}", flush=True)
        except Exception as exc:
            print(f"[Startup] Failed to pre-bake filler {text!r}: {exc}", flush=True)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/admin/login")
async def admin_login(payload: LoginRequest):
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=500, detail="ADMIN_PASSWORD is not configured on the server.")
    if not secrets.compare_digest(payload.password, ADMIN_PASSWORD):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
        )
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    token  = jwt.encode({"sub": "admin", "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/admin/candidates")
async def admin_candidates(_: None = Depends(verify_token)):
    rows = await asyncio.to_thread(db_get_all_completed)
    return rows


@app.get("/api/results/{candidate_id}")
async def get_candidate_results(candidate_id: str):
    row = await asyncio.to_thread(db_get_candidate, candidate_id)
    if not row:
        raise HTTPException(status_code=404, detail="Results not found or interview not yet complete.")
    return row


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    conversation:   list[dict] = []
    question_num    = 0
    session_start   = None
    candidate_id:   str | None = None
    candidate_name: str = ""
    candidate_email: str = ""

    # connected is sent immediately so the onboarding ping-test and the
    # interview page both get a quick acknowledgement.
    await ws.send_json({"type": "connected"})

    # ── Pre-interview loop: accept init_session, ping, then start_interview ──
    while True:
        raw = await ws.receive()
        if "text" not in raw:
            continue
        msg = json.loads(raw["text"])

        if msg.get("type") == "init_session":
            cid              = msg.get("candidate_id") or None
            candidate_email  = msg.get("email", "").strip()
            candidate_name   = msg.get("name",  "").strip()
            email = candidate_email
            name  = candidate_name

            # Re-interview prevention: block if this email already has a completed session
            if email:
                already_done = await asyncio.to_thread(db_check_email_completed, email)
                if already_done:
                    await ws.send_json({"type": "already_completed"})
                    return  # Close the handler; frontend will redirect the user

            candidate_id = cid
            if candidate_id:
                await asyncio.to_thread(db_save_candidate, candidate_id, name, email)

        elif msg.get("type") == "start_interview":
            session_start = time.time()
            break

        elif msg.get("type") == "ping":
            await ws.send_json({"type": "pong"})

    await ws.send_json({"type": "thinking"})

    opening = (
        "Hi! I'm really glad you're here today. "
        "I'd love to get a real sense of how you connect with kids, so I'm going to put you "
        "in a few little scenarios — nothing scary, just real situations tutors face. "
        "Let's start: imagine I'm a 9-year-old who's been staring at a fraction problem and "
        "I'm getting really frustrated. What do you say to me first?"
    )
    question_num = 1
    conversation.append({"role": "assistant", "content": opening})
    try:
        await send_single_turn(ws, opening, question=question_num)
    except Exception as exc:
        await ws.send_json({"type": "error", "message": f"Voice synthesis failed: {exc}"})
        return

    try:
        while True:
            raw = await ws.receive()
            user_text: str | None = None

            if "bytes" in raw:
                # WebM/Opus audio blob from frontend VAD — transcribe via Groq Whisper
                audio_bytes = raw["bytes"]
                try:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(
                            lambda: groq_client.audio.transcriptions.create(
                                model="whisper-large-v3-turbo",
                                file=("audio.webm", audio_bytes),
                                response_format="text",
                            )
                        ),
                        timeout=30.0,
                    )
                    user_text = (str(result) if result else "").strip()
                except Exception as exc:
                    print(f"[Whisper STT] error: {exc}", flush=True)
                    try:
                        await ws.send_json({"type": "ready_for_input"})
                    except Exception:
                        pass
                    continue
                if not user_text or len(user_text) <= 1:
                    await ws.send_json({"type": "ready_for_input"})
                    continue
                await ws.send_json({"type": "transcription", "text": user_text})
            elif "text" in raw:
                msg = json.loads(raw["text"])

                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
                    continue

                if msg.get("type") == "end_interview":
                    # Candidate clicked "End Interview" — score whatever conversation exists
                    scoring_task = asyncio.create_task(
                        _score_and_persist(candidate_id, conversation, candidate_name, candidate_email)
                    )
                    try:
                        await ws.send_json({"type": "interview_complete"})
                        results = await scoring_task
                        await ws.send_json({"type": "interview_results", "data": results})
                    except Exception:
                        if not scoring_task.done():
                            await scoring_task
                    break

                if msg.get("type") != "user_message":
                    continue

                user_text = msg.get("text", "").strip()
                if not user_text:
                    continue

            else:
                continue  # disconnect frame or unknown message type — skip safely

            conversation.append({"role": "user", "content": user_text})

            await ws.send_json({"type": "thinking"})

            # Send a pre-baked filler immediately to mask TTFT latency.
            if _filler_audio:
                filler_text = random.choice(list(_filler_audio.keys()))
                await ws.send_json({
                    "type": "audio_chunk", "sentence": filler_text,
                    "question": None, "first": False,
                })
                await ws.send_bytes(_filler_audio[filler_text])

            elapsed_min  = (time.time() - session_start) / 60
            is_wrapping  = elapsed_min >= SESSION_WARN_MINUTES
            force_end    = elapsed_min >= SESSION_FORCE_MINUTES

            # Sliding window: send only the last 6 messages to keep prompt tokens low.
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + conversation[-6:]
            if is_wrapping:
                messages.append({"role": "system", "content": WRAP_UP_INJECTION})

            question_num += 1
            try:
                clean_text, llm_complete = await stream_ai_response(ws, messages, question_num)
            except Exception as exc:
                if candidate_id:
                    asyncio.create_task(_score_and_persist(candidate_id, conversation, candidate_name, candidate_email))
                try:
                    await ws.send_json({"type": "error", "message": f"Streaming failed: {exc}"})
                except Exception:
                    pass
                break

            is_complete = llm_complete or force_end
            conversation.append({"role": "assistant", "content": clean_text})

            if is_complete:
                # Detach scoring from the WebSocket the moment is_complete is known.
                # create_task() schedules it on the event loop; it will run to completion
                # even if the client closes the tab before interview_results is delivered.
                scoring_task = asyncio.create_task(
                    _score_and_persist(candidate_id, conversation, candidate_name, candidate_email)
                )
                try:
                    await ws.send_json({"type": "interview_complete"})
                    results = await scoring_task
                    await ws.send_json({"type": "interview_results", "data": results})
                except Exception:
                    # Client disconnected mid-scoring. Ensure the task finishes
                    # so the DB write is not abandoned.
                    if not scoring_task.done():
                        await scoring_task
                break

    except WebSocketDisconnect:
        pass
