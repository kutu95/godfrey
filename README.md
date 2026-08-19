# Captain John Godfrey Chat App

A Node.js web app that simulates a conversation with Captain John Godfrey (SS Georgette, 1876) using either Anthropic Claude or OpenAI.

## 1) Install dependencies

```bash
npm install
```

## 2) Add your API key(s)

Edit `.env`:

```env
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_openai_key_here
ELEVENLABS_API_KEY=your_elevenlabs_key_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
ELEVENLABS_STABILITY=0.5
ELEVENLABS_SIMILARITY_BOOST=0.75
ELEVENLABS_SPEAKER_BOOST=true
```

### Reply latency

On the direct (game mic) path the Brain streams the model's reply straight into
ElevenLabs' WebSocket TTS, so Godfrey begins speaking while he is still composing
the rest of the answer. Measured against the previous wait-then-speak behaviour
this cuts about 1.5 seconds off the silence before he starts.

Set `GODFREY_PIPELINE_LLM_TTS=0` to turn it off and restore the old behaviour. A
single request can also opt out by sending `"pipeline": false` in the body of
`POST /api/godfrey/speak/stream-pcm`, which is handy for A/B comparisons without
restarting. If the WebSocket cannot be opened, the Brain falls back to the
original HTTP path on its own.

See `SPEECH_PIPELINE.md` for the engineering detail behind this path: cue stripping,
the reply word cap, model choices, and why response caching was rejected.

### Visitor memory within an encounter

The direct exhibition path sends one utterance at a time with no conversation history, so
`lib/visitor-profile.js` keeps a small in-memory profile per encounter — the visitor's name,
whether they have been to sea, places they know, and which questions Godfrey has already
put to them — and renders it into the prompt. This is what lets him remember a name, pitch
his sea-talk to the person in front of him, and avoid asking the same thing twice.

A small watchlist (`config/notable-visitors.json`) can also recognise a known visitor from
what they say — not from the webcam. Given name on the list (e.g. Marcia) makes him ask
for the family name once; a confirmed surname (with speech-to-text aliases) plays the
authored occasion `occasions/marcia-van-zeller.md` verbatim, once, then remembers them for
the rest of the encounter. Staff can still queue that occasion from Admin if the mic misses
the name.

Profiles are memory-only and never written to disk. Session logs in `logs/` are unchanged
and still record what visitors said verbatim.

### Pronunciation

ElevenLabs reads the spoken line after performance cues are stripped. Bracket notes such as
`[pronounced VASS]` never reach the voice. To correct a misread name, add a whole-word pair
in `config/tts-pronunciations.json` (`Vasse` → `Vass`, `Marcia` → `Mar-see-ah`). Logs and
Unreal still see the original spelling; only the TTS payload is rewritten. Restart the Brain
after editing that file.

A profile is cleared when the visitor says goodbye, and after an idle gap on the same
client, so the next person to walk up is a stranger:

```env
GODFREY_VISITOR_SESSION_IDLE_MS=90000
```

Check the extraction heuristics after editing them:

```bash
node scripts/check-visitor-profile.js
```

## 3) Add source documents

Place your PDF files in the `docs/` folder.

## 4) Upload PDFs for Anthropic (one-time per document set)

Run the one-time upload script to send PDFs to the Anthropic Files API and generate `file-ids.json`:

```bash
node upload-docs.js
```

The script logs each uploaded filename and file ID, then writes all IDs to `file-ids.json`.

**Source of truth:** After you change documents on your **development machine**, run `upload-docs.js` there, then **commit and push** `file-ids.json` with the rest of the app. Production servers should use that repository copy (see **Deploying updates** below), not a separately edited file on the server.

## 5) Upload PDFs for OpenAI (one-time per document set)

Run this script to create an OpenAI vector store and upload your PDFs:

```bash
node upload-openai-docs.js
```

The script writes vector-store metadata to `openai-file-ids.json`.

## 6) Start the server

```bash
node server.js
```

Open your browser at [http://localhost:3000](http://localhost:3000).

## Unreal API (local integration)

Base URL (local):

`http://localhost:3000`

### Unreal always-on mic (streaming STT)

Additive path for the game microphone. **Does not change** browser Web Speech or `POST /api/chat`.

1. Unreal connects to `ws://localhost:3000/api/unreal/stt`
2. Streams **PCM16 LE mono @ 24 kHz** as binary WebSocket frames
3. Brain proxies to OpenAI Realtime transcription (`gpt-4o-mini-transcribe` + `server_vad` by default; `gpt-live-transcribe` uses local VAD because it rejects turn detection)
4. On `transcript_completed`, Unreal sends the text through the existing `POST /api/godfrey/speak/stream-pcm` text path (same as DirectSpeech)

Control messages (JSON text frames): `{ "type":"control", "action":"pause"|"resume"|"clear" }` — pause while Godfrey is speaking so loudspeakers do not re-trigger STT.

Env knobs: `GODFREY_UNREAL_STT_MODEL`, `GODFREY_UNREAL_STT_SILENCE_MS` (default **1500**), `GODFREY_UNREAL_STT_THRESHOLD` (default **0.50**), `GODFREY_UNREAL_STT_KEYWORDS`. One-word noise hallucinations (`cool`, `hello`) are dropped.

Endpoint:

`POST /api/unreal/ask`

## Unreal: browser-first exhibition (PCM stream)

When the web UI uses `data-godfrey-default-output-target="unreal"` on `<main>` (default in this repo), each **typed or push-to-talk** message calls `POST /api/chat` with `outputTarget: "unreal"`. The server runs the LLM **once**, returns JSON to the browser (same as before), and **queues** the assistant text for Unreal.

**Unreal (Blueprint / `StreamGodfreySpeechToAudio`)** should:

1. Optionally poll `GET http://<host>:<port>/api/exhibition/unreal-tts-status`.
   - While the LLM is still running after an Unreal-targeted question: `{ "ready": false, "phase": "awaiting_reply", "requestId": "..." }` — UE starts a listening montage (`NotifyReplyIncoming`).
   - When the reply is queued: `{ "ready": true, "requestId": "...", "performanceEvents": [...] }`.
2. `POST /api/godfrey/speak/stream-pcm` with JSON body including the same **`requestId`**, plus **`ttsOnly: true`**, **`sampleRate`**, **`numChannels`** (same as your existing stream). The response body is still **raw PCM** (`audio/L16`); ElevenLabs streams the **queued** assistant reply (no second LLM on the server).

`ttsOnly` consumes the queue for that `requestId`. If nothing is queued you get **409** JSON (not PCM).

The `awaiting_reply` phase is set as soon as `POST /api/chat` accepts an Unreal-targeted question (before the LLM finishes) and cleared when TTS is queued, on chat error, on queue consume, or when the TTL expires (`GODFREY_EXHIBITION_UNREAL_TTS_TTL_MS`).

**Browser-only mode:** remove `data-godfrey-default-output-target` from `<main>` or set `localStorage.setItem("godfrey-output-target","browser")` and reload. Optional env: `GODFREY_DEFAULT_OUTPUT_TARGET=browser|unreal` when the client omits `outputTarget`.

Queue TTL: `GODFREY_EXHIBITION_UNREAL_TTS_TTL_MS` (default 180000).

### Occasion scripts (verbatim Unreal speeches)

Authored speeches live in `occasions/*.md` and are queued without the LLM. Unreal plays them through the same exhibition `ttsOnly` path.

- Admin UI: sign in → **Occasion scripts** → select → **Queue for Unreal**
- CLI: `npm run speak-occasion -- michael-get-well` (Brain must be running; uses `ADMIN_PASSWORD`)
- Details: [`occasions/README.md`](occasions/README.md)

**Quick test checklist**

1. **Typed → Unreal:** With `data-godfrey-default-output-target="unreal"`, type in browser, confirm JSON includes `unrealTts.queued` and `requestId`; poll `GET /api/exhibition/unreal-tts-status`; POST `stream-pcm` with `ttsOnly: true` and same `requestId`; MetaHuman plays PCM.
2. **Speech → Unreal:** Same as (1) using push-to-talk; `voiceInteraction: true` appears in `/api/chat` body (for logs); same `requestId` ties voice latency to queue.
3. **Browser-only:** Set `localStorage` `godfrey-output-target` to `browser` or remove `data-godfrey-default-output-target` from `<main>`; confirm admin/browser TTS still works and `unrealTts` is absent from `/api/chat` JSON.
4. **BeginPlay silent:** No server change for UE BeginPlay; confirm Blueprint no longer auto-calls stream on play (your UE change).
5. **ACE lip sync:** Unchanged; PCM format and route are the same as pre-`ttsOnly` Unreal-initiated streams.

### A) Ask with text (JSON)

```bash
curl -X POST "http://localhost:3000/api/unreal/ask" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"What happened on the morning of the wreck?\",\"sessionId\":\"optional-session-id\"}"
```

### B) Ask with raw audio body (existing STT pipeline)

```bash
curl -X POST "http://localhost:3000/api/unreal/ask" \
  -H "Content-Type: audio/wav" \
  --data-binary "@./question.wav"
```

You can also send `application/octet-stream` for raw audio buffers.

### C) Ask with base64 audio in JSON

```bash
curl -X POST "http://localhost:3000/api/unreal/ask" \
  -H "Content-Type: application/json" \
  -d "{\"audioBase64\":\"<base64-audio>\",\"audioMimeType\":\"audio/webm\"}"
```

### Response shape

```json
{
  "success": true,
  "sessionId": "session-...",
  "text": "Godfrey response text",
  "speechProvider": "elevenlabs",
  "audioUrl": "http://localhost:3000/audio/generated/....mp3",
  "wavUrl": "http://localhost:3000/audio/generated/....wav",
  "mimeType": "audio/mpeg",
  "durationSeconds": 0,
  "suggestedFilename": "godfrey-response-YYYYMMDD-HHMMSS.mp3",
  "emotion": null,
  "intensity": null,
  "gesture": null
}
```

## 7) Deploying updates (e.g. VPS)

### Standard server update procedure

Use this from your server shell:

```bash
cd /apps/godfrey
git pull origin main
```

If your process manager does not auto-reload the app, restart after pulling (example):

```bash
pm2 restart godfrey-app
```

Pulling updates keeps the server in sync with the repository. The committed **`file-ids.json` from your dev host is the master** for Anthropic file IDs; it is meant to be in the repo and updated on the server when you pull.

If `git pull` refuses because the server has local changes to `file-ids.json`, drop those edits so Git can replace the file with the version from the repository:

```bash
cd /apps/godfrey
git restore file-ids.json
git pull origin main
```

Use the same pattern for `openai-file-ids.json` if that file was modified only on the server but you want the repository copy to win.

## Notes

- The UI includes a provider switcher so you can choose Claude or OpenAI.
- The app remembers your last selected provider in `provider-config.json` and uses it after restart.
- Anthropic context comes from `file-ids.json` (uploaded via `upload-docs.js`).
- OpenAI context comes from `openai-file-ids.json` and its vector store (uploaded via `upload-openai-docs.js`).
- Document files are sent on the first turn by default, then omitted on later turns for speed.
- Use "Refresh Document Context (Next Reply)" in the UI when you want the next response to include document context again.
- The chat input includes a Dictate button for browser speech-to-text (when supported).
- Speech settings now support four playback modes: no speech, simple browser speech, OpenAI speech, and ElevenLabs speech.
- You can tune voice settings in-app (voice/model/speed/rate/pitch) and provide a voice expression prompt for tone and emotion.
- ElevenLabs settings (API key, voice/model IDs, stability, similarity boost, speaker boost) are persisted in `elevenlabs-config.json`.
- A British accent boost toggle and "Apply Strong British Preset" button are available to maximize British delivery in both OpenAI and browser speech.
- The app includes an Admin system prompt panel to load, append to, or replace the prompt while running.
- Prompt changes are saved to `system-prompt.json` and persist across server restarts.
- Keep your API key private and never expose it in frontend code.
- To deploy publicly, you can host this Express app on Railway, Render, or a VPS.
