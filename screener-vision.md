# AI Tutor Screener — Product Vision

## What We're Building
A 10-minute AI-powered voice interview that screens math tutor candidates for soft skills before any human is involved. The conversation is natural, adaptive, and evaluates five dimensions: communication clarity, patience, warmth, ability to simplify, and English fluency.

This is not a quiz. There are no right answers. The system listens for *how* candidates communicate, not *what* they know.

---

## The Conversation

- **Duration**: ~10 minutes, 4–6 questions
- **Format**: Voice-only. Candidate speaks; AI listens, responds, and follows up
- **Tone**: Warm, professional, unhurried — like a thoughtful human interviewer
- **Adaptability**: The AI follows up on vague answers, gently redirects tangents, and re-prompts one-word responses
- **Questions reveal**: How candidates explain to confused students, how they handle frustration, how they simplify complex ideas

**Sample questions:**
- "How would you explain what a fraction means to a 9-year-old who's never heard the word?"
- "A student has been staring at the same problem for 5 minutes and says 'I just don't get it.' What do you do?"
- "You've explained something twice and they still look confused. What's your next move?"
- "How do you keep a student engaged when the topic feels boring to them?"

---

## Assessment Rubric

Five scored dimensions (1–5 scale). Every score requires a direct quote from the transcript as evidence.

| Dimension | Weight | What We're Listening For |
|-----------|--------|--------------------------|
| Communication Clarity | 25% | Simplifies, avoids jargon, uses analogies |
| Warmth & Empathy | 20% | Acknowledges frustration, reassures, makes students feel safe |
| Patience & Composure | 20% | No rushing, comfortable with silence, zero condescension |
| Adaptability | 15% | Pivots explanation style, reads confusion signals |
| English Fluency | 10% | Pronunciation, sentence structure, minimal filler words |

Output: structured report with weighted score, dimension breakdown, supporting quotes, confidence rating, and hire/no-hire recommendation.

---

## Frontend: Cozy Luxury UI

### Design Language
- **Aesthetic**: Minimalist, warm, premium. Think a high-end meditation app crossed with a Notion doc. Muted earth tones (warm cream, soft charcoal, gentle amber) with a single accent color.
- **Typography**: Elegant serif for headings, clean sans-serif for body. Generous whitespace.
- **Motion**: Subtle, purposeful animations. Nothing jarring. Everything feels considered.
- **Responsiveness**: Smooth state transitions. The UI must never feel frozen or uncertain.

### Three Distinct Visual States

#### 1. Listening State
> The candidate is speaking.

- **Visual**: Active audio waveform — a live visualization of the candidate's microphone input. Bars or a wave form that responds in real time to their voice amplitude.
- **Color**: Warm amber / soft gold tones
- **Label**: Subtle "Listening…" text below the waveform
- **Behavior**: Waveform is always visible when mic is active, even during silence (flatline), so candidate knows the system is paying attention

#### 2. Thinking State
> Whisper is transcribing / LLM is generating the next response.

- **Visual**: A gentle, slow-pulsing glow — a soft orb or ring that breathes in and out rhythmically
- **Color**: Soft indigo or cool lavender — distinct from listening/speaking states
- **Label**: Subtle "Thinking…" text
- **Behavior**: No spinner, no progress bar. The pulse is calm and reassuring — signals that the AI is processing, not broken

#### 3. Speaking State
> The AI interviewer is playing its response.

- **Visual**: Audio playback visualization — a smooth waveform or equalizer-style animation synced to the AI's TTS audio output
- **Color**: Soft teal or warm sage green
- **Label**: Subtle "Speaking…" text
- **Behavior**: Animation is tied to actual audio amplitude, not a looping dummy animation. When audio ends, it fades smoothly into the Listening state

### Additional UX Details
- **Intro screen**: Warm welcome, explicit rubric preview ("Here's what we're listening for"), audio test, consent
- **Progress indicator**: Subtle "Question 2 of 5" — no timer visible (reduces anxiety)
- **Post-interview**: Candidate sees their own score summary with a positive framing
- **Accessibility**: High contrast mode, caption display option, keyboard navigable

---

## Candidate Experience Principles

1. **Psychological safety first**: Warm voice persona, slow pacing, no time pressure
2. **Radical transparency**: Show the rubric before the interview starts. Explain what we score and why.
3. **Fairness signals**: Explicitly separate English fluency from communication quality. Non-native speakers know we're evaluating their teaching, not their accent.
4. **This may be their first Cuemath interaction**: The UX is the brand. It should feel premium, fair, and human — even though it's AI.
5. **Appeal mechanism**: Post-interview, candidate can flag a score they disagree with

---

## Edge Cases the System Must Handle

| Scenario | Handling |
|----------|----------|
| One-word answer | Re-prompt up to 2x with specific follow-ups; then note as "minimal response" in rubric |
| Long tangent (>90s) | Politely redirect: "That's great context — let me refocus us…"; still score the content |
| Choppy audio | Buffer monitor; warn candidate; if Whisper confidence <70%, flag for human review |
| Non-native accent | Separate fluency score; display transcription confidence metric in output |
| Candidate drops off | Save partial transcript; allow resume within 24 hours |
| Silence / no response | After 8 seconds, gentle prompt: "Take your time — whenever you're ready." |

---

## Success Metrics

- Interview completion rate > 85%
- Candidate satisfaction ("Did this feel fair?") > 4/5
- Hiring team override rate < 15% (system's recommendation matches human judgment)
- Time-to-screen reduced from 2 days → 30 minutes
