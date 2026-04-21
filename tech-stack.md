# Tech Stack

## Frontend
- **Framework:** Next.js
- **Styling:** Tailwind CSS

## Backend
- **Framework:** Python FastAPI

## Communication
- **Protocol:** WebSockets — zero-latency bidirectional messaging between client and server

## Speech-to-Text (STT)
- **Library:** `xenova/whisper-web`
- **Runs:** Client-side (in-browser via ONNX/Transformers.js — no server round-trip for transcription)

## LLM
- **Provider:** Groq API
- **Reason:** Ultra-fast inference latency

## Text-to-Speech (TTS)
- **Engine:** Piper TTS
- **Runs:** Server-side inside the FastAPI backend
- **Note:** Local process — warm, natural voice quality; does NOT use the browser Web Speech API
