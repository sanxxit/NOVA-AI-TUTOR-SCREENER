# AI Tutor Screener — Evaluation Rubric

## Philosophy

Every score must be earned, not inferred. The system extracts exact quotes from the transcript as evidence for each dimension score. No score is issued without a supporting quote. The final report is designed to be shown to the candidate — transparent, specific, and actionable.

---

## The 5 Dimensions

### 1. Communication Clarity
**Weight: 25% | What it measures:** Can the candidate explain a concept so a confused child understands it? Do they strip away jargon, use relatable analogies, and build up from simple foundations?

| Score | Label | Behavioral Indicator |
|-------|-------|----------------------|
| 1 | Not Demonstrated | Uses jargon or technical terms without explanation; explanation would confuse a child |
| 2 | Developing | Attempts to simplify but still includes unnecessary complexity; explanation partially clear |
| 3 | Meets Expectation | Clear explanation with minimal jargon; a student could follow along |
| 4 | Proficient | Adjusts vocabulary to audience; uses one strong analogy or concrete example |
| 5 | Exemplary | Breaks complex ideas into intuitive steps; uses relatable analogies; checks for understanding |

**Probe questions:**
- "Explain what a fraction means to a 9-year-old who's never heard the word."
- "How would you describe what a variable is to a 12-year-old?"

**Evidence format:**
```
Score: 4/5
Quote: "A fraction is like cutting a pizza — the bottom number is how many slices total,
        the top number is how many slices you're taking."
Why: Used a concrete, relatable analogy. Clear and age-appropriate language. No jargon.
```

---

### 2. Warmth & Empathy
**Weight: 20% | What it measures:** Does the candidate make students feel safe being confused? Do they acknowledge frustration, validate effort, and create psychological safety — or do they push through regardless of the student's emotional state?

| Score | Label | Behavioral Indicator |
|-------|-------|----------------------|
| 1 | Not Demonstrated | Dismissive of confusion; moves on without acknowledging student frustration |
| 2 | Developing | Acknowledges difficulty but matter-of-fact; no emotional attunement |
| 3 | Meets Expectation | Recognizes frustration and offers support; language is kind |
| 4 | Proficient | Proactively validates effort before correcting; makes student feel seen |
| 5 | Exemplary | Exceptional warmth; makes student feel that confusion is normal and expected; highly personalized |

**Probe questions:**
- "A student has been staring at the same problem for 5 minutes and says 'I just don't get it.' What do you do?"
- "How do you respond when a student gets upset because they keep making the same mistake?"

**Evidence format:**
```
Score: 5/5
Quote: "I'd tell them — honestly — that this exact thing confused me too when I first learned it.
        And that's completely normal. Then I'd say: let's forget the problem for a second and just
        talk through what we do know."
Why: Normalizes confusion, models vulnerability, de-escalates anxiety before re-engaging.
```

---

### 3. Patience & Composure
**Weight: 20% | What it measures:** Does the candidate rush? Do they get frustrated when a student doesn't understand? Can they sit in the discomfort of a confused student without trying to speed through it?

| Score | Label | Behavioral Indicator |
|-------|-------|----------------------|
| 1 | Not Demonstrated | Rushes through explanations; shows impatience; interrupts |
| 2 | Developing | Generally patient but occasionally shows mild frustration or hurries |
| 3 | Meets Expectation | Consistently patient and calm throughout; no signs of frustration |
| 4 | Proficient | Very patient; uses deliberate pauses; comfortable with silence |
| 5 | Exemplary | Extraordinary composure; treats confusion as a signal to slow down, not speed up |

**Probe questions:**
- "You've explained the same concept three times and the student still doesn't understand. Walk me through what you do."
- "How do you handle a student who keeps interrupting you mid-explanation?"

**Behavioral signals (beyond quotes):**
- Response latency after candidate finishes: ≥2 seconds = composed; <0.5 seconds = rushing
- Interruption count during candidate's answer: 0 = ideal
- Silence comfort: does candidate fill every pause or allow space?

**Evidence format:**
```
Score: 3/5
Quote: "I'd just explain it again, maybe with a different example."
Note: Answer is functional but brief. No mention of slowing down, checking in, or
      adjusting pace. Doesn't indicate intentional patience — just repetition.
```

---

### 4. Adaptability
**Weight: 15% | What it measures:** Does the candidate have more than one gear? When the first explanation fails, do they genuinely try a different *method* — or just repeat the same explanation louder/slower?

| Score | Label | Behavioral Indicator |
|-------|-------|----------------------|
| 1 | Not Demonstrated | Repeats the same explanation when student doesn't understand; no strategy shift |
| 2 | Developing | Attempts to adapt when directly prompted, but not proactively |
| 3 | Meets Expectation | Proactively shifts approach when confusion signals appear |
| 4 | Proficient | Has multiple strategies ready (visual, analogy, real-world, story-based); picks based on student |
| 5 | Exemplary | Reads student cues naturally; seamlessly pivots between methods; observes learning style and adapts |

**Probe questions:**
- "You've explained something twice and they're still confused. What's your next move?"
- "Some students learn visually, some by doing, some by hearing. How do you figure out which type your student is?"

**Evidence format:**
```
Score: 4/5
Quote: "If talking through it isn't working, I'll try drawing a diagram — or sometimes I just
        ask them to explain it back to me in their own words, because that usually shows me
        exactly where the gap is."
Why: Two distinct alternative strategies mentioned. Second strategy (explain-back) is
     particularly diagnostic — shows meta-awareness of learning process.
```

---

### 5. English Fluency
**Weight: 10% | What it measures:** Is the candidate's spoken English clear enough that a student can follow without effort? This dimension is scored separately from Communication Clarity — a candidate can have excellent teaching clarity *and* a strong accent. We score these independently.

| Score | Label | Behavioral Indicator |
|-------|-------|----------------------|
| 1 | Not Demonstrated | Difficult to understand; frequent mispronunciations; significant comprehension barrier |
| 2 | Developing | Occasional clarity issues; accent or grammar sometimes disrupts understanding |
| 3 | Meets Expectation | Clear and understandable; accent present but does not hinder comprehension |
| 4 | Proficient | Very clear speech; minimal filler words ("um", "uh"); smooth sentence structure |
| 5 | Exemplary | Excellent articulation; natural pacing; no filler words; highly easy to follow |

**Technical metrics (from Whisper):**
- Word Error Rate (WER): <5% = excellent, 5–15% = acceptable, >15% = flag for review
- Transcription confidence: <70% triggers human review flag
- Filler word count: tracked automatically

**Important note on bias:**
> A low fluency score does not affect the hire decision if Communication Clarity, Warmth, Patience, and Adaptability scores are strong. English Fluency is a signal for the hiring team, not a gate. Candidates with transcription confidence <70% are automatically flagged for human review before a final decision is issued.

**Evidence format:**
```
Score: 4/5
Transcription confidence: 91% | WER: 3.2% | Filler words: 4
Note: Clear, natural pacing. Minor filler words ("um") present but not distracting.
      No comprehension barriers detected.
```

---

## Weighted Score Calculation

```
Total Score = (Clarity × 0.25) + (Warmth × 0.20) + (Patience × 0.20) +
              (Adaptability × 0.15) + (Fluency × 0.10)

Maximum possible: 5.0
```

| Total Score | Tier | Decision |
|-------------|------|----------|
| 4.0 – 5.0 | Tier 1: Strong Hire | Pass — move to paid trial immediately |
| 3.0 – 3.9 | Tier 2: Conditional Hire | Pass — move forward with coaching note |
| 2.0 – 2.9 | Tier 3: Not Ready | Fail — encourage to reapply in 3 months |
| < 2.0 | Tier 4: Not a Fit | Fail — strong mismatch with role requirements |

---

## Full Output Report Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TUTOR SCREENING REPORT
  Candidate: [Name] | Date: [YYYY-MM-DD] | Duration: [X min]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  DECISION: ✅ PASS — Tier 2: Conditional Hire

  OVERALL SCORE: 3.6 / 5.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DIMENSION SCORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Communication Clarity    4 / 5  ████████░░
  ✦ "A fraction is like cutting a pizza — the bottom number is how
     many slices total, the top is how many you're taking."
  → Strong analogy. Age-appropriate. No jargon.

  Warmth & Empathy         4 / 5  ████████░░
  ✦ "I'd tell them that this exact thing confused me too when I first
     learned it — and that's completely normal."
  → Normalizes confusion, models vulnerability. Excellent.

  Patience & Composure     3 / 5  ██████░░░░
  ✦ "I'd just explain it again with a different example."
  → Functional but brief. Doesn't describe slowing down or checking in.
  ⚠ Improve: Describe how you intentionally adjust your pace and
     create space for the student to process.

  Adaptability             3 / 5  ██████░░░░
  ✦ "I might try drawing it out."
  → Only one alternative strategy mentioned. No diagnostic approach.
  ⚠ Improve: Build a repertoire of 3+ methods (visual, story, real-
     world, explain-back). Show how you choose between them.

  English Fluency          5 / 5  ██████████
  ✦ Transcription confidence: 94% | WER: 2.1% | Filler words: 2
  → Excellent articulation. Natural pacing. Easy to follow.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HIRING TEAM NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Strengths: Strong communicator with real warmth. Analogy use is
  excellent. Students will feel safe with this candidate.

  Watch for: Patience dimension is functional but underdeveloped.
  Monitor in trial sessions — does she slow down when students
  struggle, or push through?

  Assessment confidence: HIGH
  Audio quality: Excellent | Transcript completeness: 100%
  Human review flag: None

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CANDIDATE-FACING FEEDBACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Congratulations — you've passed to the next stage! Here's what
  stood out, and where you have room to grow:

  What you did well:
  • Your analogy for fractions was excellent — concrete and memorable.
  • You showed real empathy. Normalizing confusion is a superpower
    in tutoring.

  To strengthen further:
  • Patience: Try describing not just *what* you'd try differently,
    but *how* you'd slow down and create space for the student.
  • Adaptability: Think about building a toolkit of 3–4 different
    explanation methods you can switch between.

  Next step: A human hiring manager will reach out within 24 hours.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## LLM Scoring Prompt Template

The following system prompt instructs the LLM to score the transcript against this rubric:

```
You are an expert evaluator for a tutor hiring platform. You will be given a transcript
of a voice interview with a tutor candidate. Your job is to score the candidate on 5
dimensions using the rubric below.

RULES:
- Every score (1-5) MUST be accompanied by an exact quote from the transcript.
- Do not infer. If evidence is absent, score that dimension as 1 and note "No evidence found."
- Separate English Fluency from Communication Clarity — a strong non-native speaker can
  score 5 on Clarity and 3 on Fluency.
- Be specific in improvement feedback. "Speak more clearly" is not actionable.
  "Describe how you adjust your pace when a student looks confused" is actionable.
- Output must follow the JSON schema below exactly.

DIMENSIONS:
1. Communication Clarity (weight: 0.25) — simplification, analogies, jargon removal
2. Warmth & Empathy (weight: 0.20) — acknowledgment of frustration, validation, safety
3. Patience & Composure (weight: 0.20) — no rushing, comfort with silence, no frustration
4. Adaptability (weight: 0.15) — multiple explanation methods, reads confusion signals
5. English Fluency (weight: 0.10) — pronunciation clarity, sentence structure, filler words

OUTPUT JSON SCHEMA:
{
  "dimensions": {
    "clarity":      { "score": 1-5, "quote": "...", "reasoning": "...", "improvement": "..." },
    "warmth":       { "score": 1-5, "quote": "...", "reasoning": "...", "improvement": "..." },
    "patience":     { "score": 1-5, "quote": "...", "reasoning": "...", "improvement": "..." },
    "adaptability": { "score": 1-5, "quote": "...", "reasoning": "...", "improvement": "..." },
    "fluency":      { "score": 1-5, "wer": float, "confidence": float, "filler_count": int, "note": "..." }
  },
  "weighted_total": float,
  "tier": "Tier 1 | Tier 2 | Tier 3 | Tier 4",
  "decision": "PASS | FAIL",
  "hiring_team_notes": "...",
  "candidate_feedback": "...",
  "flags": {
    "human_review_required": bool,
    "reason": "..." // only if true
  }
}
```

---

## Human Review Triggers

Any of the following automatically flags the report for human review before a final decision:

| Trigger | Threshold |
|---------|-----------|
| Low transcription confidence | Whisper confidence < 70% |
| Extreme score variance | Any dimension differs from mean by > 2 points |
| Borderline overall score | Weighted total between 2.8 – 3.2 |
| Incomplete interview | Candidate answered fewer than 3 of 5 questions |
| Technical issues | Audio quality warning during session |
