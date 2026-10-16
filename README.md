# Buddy 英语老师 (Voice Agent for Kids)

A real-time voice agent running entirely inside a Durable Object, reframed as
**Buddy** — a patient, friendly English teacher for Chinese children aged 7-8.
Kids talk to Buddy in simple English; Buddy replies in 1-2 short sentences,
asks a follow-up question, and encourages gently. Features a bright, large-type
child UI, a one-tap **中文解释** mode (Buddy explains in simple Chinese), and a
**导出学习资料** button that downloads the dialog + a word list.

Uses Workers AI by default, so it runs with zero external API keys. The STT
provider selector can choose between Workers AI Flux and Workers AI Nova 3:

- **STT**: Workers AI Flux (`@cf/deepgram/flux`) by default, or Workers AI Nova 3 (`@cf/deepgram/nova-3`)
- **TTS**: Deepgram Aura (`@cf/deepgram/aura-1`) for English, MyShell MeloTTS (`@cf/myshell-ai/melotts`, `lang:"zh"`) for the 中文解释 Chinese-explanation mode — both run on Workers AI with no extra keys
- **Turn detection**: Flux `StartOfTurn` / `EndOfTurn` events
- **LLM**: Kimi K2.7 Code (`@cf/moonshotai/kimi-k2.7-code`), GPT OSS 20B, or GLM 4.7 Flash

## Run it

```bash
npm install
npm run start
```

No API keys are needed — Workers AI STT/TTS/LLM all run with zero configuration.
If you want the optional WebRTC/SFU transport, copy `.env.example` to `.env`
and set `CLOUDFLARE_REALTIME_SFU_APP_ID` / `CLOUDFLARE_REALTIME_SFU_API_TOKEN`.

## How it works

```
Browser                          Durable Object (VoiceAgent)
┌──────────┐   binary WS frames   ┌──────────────────────────┐
│ Mic PCM  │ ────────────────────► │ Audio Buffer             │
│ (16kHz)  │                       │   ↓                      │
│          │                       │ STT (flux)               │
│          │                       │   ↓                      │
│          │   JSON: transcript    │   ↓                      │
│          │ ◄──────────────────── │ LLM                      │
│          │   binary: MP3 audio   │   ↓ (sentence chunking)  │
│ Speaker  │ ◄──────────────────── │ TTS (aura-1, streaming)  │
└──────────┘                       └──────────────────────────┘
              single WebSocket connection
```

1. Browser captures mic audio via AudioWorklet, downsamples to 16kHz mono PCM
2. PCM streams to the Agent over the existing WebSocket connection (binary frames)
3. The selected STT provider detects speech and turn completion server-side
4. Agent runs the voice pipeline: STT → LLM (with tools) → streaming TTS
5. TTS audio streams back per-sentence as MP3 while the LLM is still generating
6. Browser decodes and plays audio through the selected speaker when supported; user can interrupt at any time

## Features

- **Streaming TTS** — LLM output is split into sentences and synthesized concurrently, so the user hears the first sentence while the rest is still being generated.
- **Interruption handling** — speak over the agent to cut it off mid-sentence. Flux speech-start events abort the server pipeline and stop queued browser playback; client audio-level detection remains as a fallback.
- **Provider selector** — choose between Workers AI Flux and Workers AI Nova 3 STT without changing the agent code.
- **Server-side turn detection** — the selected STT provider handles speech boundaries, so the example does not need client-side end-of-speech signaling to run the voice pipeline.
- **Provider tuning** — Workers AI Flux and Nova-3 expose keyterms to bias transcription.
- **Speaker selection** — choose an audio output device for assistant playback. Unsupported browsers keep using the system default output.
- **Conversation persistence** — all messages are stored in SQLite and survive restarts. The agent remembers previous conversations.
- **Agent tools** — the LLM can call `get_current_time`, `set_reminder`, and `get_weather` during conversation.
- **Proactive scheduling** — reminders set via voice fire on schedule and are spoken to connected clients (or saved to history if disconnected).
- **`useVoiceAgent` hook** — the client uses the `agents/voice-react` hook, which encapsulates all audio infrastructure in ~10 lines of setup.
