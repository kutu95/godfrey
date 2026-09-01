# Godfrey speech pipeline: latency and reply shaping

Engineering notes for the direct (game mic) speech path. Setup and API usage live in
`README.md`; this file explains *why* the path is built the way it is.

The Unreal-side counterpart, covering ACE / Audio2Face ingest and lip sync, is
`D:/UE Projects/MetaHuman_Baseline_UE58_Test/Docs/GodfreySpeechPipeline.md`.

---

## LLM-to-TTS pipelining

`lib/godfrey-speech-pipeline.js` streams the model's tokens straight into the ElevenLabs
WebSocket TTS endpoint, so Godfrey starts speaking while he is still composing the rest of
the answer. Measured against wait-then-speak, this removes roughly **1.5 seconds** of
silence before he starts.

LLM inference was the dominant latency term, not TTS and not the network. Overlapping the
two is the single largest win available on this path.

**Controls**

- `GODFREY_PIPELINE_LLM_TTS=0` disables it globally.
- `"pipeline": false` in the body of `POST /api/godfrey/speak/stream-pcm` opts a single
  request out, which is useful for A/B comparison without a restart.
- Failures throw `PIPELINE_FALLBACK_CODE` and the Brain falls back to the original HTTP
  path automatically, but **only while no audio has been sent**. Once PCM is flowing there
  is nowhere to fall back to, so the error propagates.
- If the LLM token stream goes idle for **8 seconds** after it has started (`LLM_IDLE_TIMEOUT_MS`),
  the pipeline aborts the model request and flushes ElevenLabs with the text so far, then
  `res.end()`. Without this, Unreal is left playing a truncated reply with HTTP still open,
  so the audio-end watchdog will not finish the utterance (silent lip-sync). Unreal also
  recovers on its own after `GodfreyAceIngestStallTimeoutSeconds` of no new PCM once
  playback has caught what was sent.

**Things that had to be handled**

- The LLM must stop generating the moment the TTS socket drops, otherwise tokens are
  generated with nowhere to go. Guarded by a `ws.readyState !== WebSocket.OPEN` check.
- The `finished` promise is not awaited until the model has finished streaming, so an
  early WebSocket error would escape as an unhandled rejection. Suppressed with
  `finished.catch(() => {})`.

---

## Streaming cue stripping

Godfrey's replies contain performance cues (`[thinking]`, `[gesture:QuietSmile_01]`,
`*mutters*`) that Unreal consumes but ElevenLabs must never speak.

Stripping cannot be done with a simple regex on a token stream, because a cue can be split
across deltas — `[ges` in one chunk and `ture:Wave_01]` in the next. `createStreamingCueStripper`
in `lib/performance-text.js` holds back any trailing unterminated cue (`unterminatedCueIndex`),
emits only the safe prefix, and flushes the remainder at the end.

Without this, half-written cue text is sent to TTS and Godfrey reads his own stage
directions aloud.

---

## Reply length

Live visitor replies have **no hard word quota**. `response-config.json` `maxWords` is **0**
by default (admin UI: 0 = no cap). The 80-word guillotine was removed because it cut him
mid-sentence (`"...all their hours ahead"`). Length is now by instruction: answer, then wait;
do not recap the wreck unless asked (`BREVITY_ADDENDUM` in `server.js`).

A runaway ceiling remains: `MAX_RESPONSE_TOKENS` (420) on the OpenAI request, so a dump
cannot run for minutes. If an operator sets `maxWords` above 0, the old pipeline behaviour
returns — stop at a sentence end past the cap, with `WORD_CAP_SENTENCE_GRACE_WORDS` (25) as
a hard extra, and `limitResponseToWordCount` on the non-pipelined / chat path.

Occasion drafts still honour an explicit word cap when the operator types one.

---

## Model choices

**TTS: `eleven_turbo_v2_5`.** Chosen after comparing against `multilingual_v2`, `flash_v2_5`
and `v3`. Best balance of voice quality and latency for Godfrey specifically — this was a
subjective call on the voice, not purely a latency ranking.

**`eleven_v3` cannot be used on this path.** It supports emotion audio tags, which are
attractive, but it has **no WebSocket endpoint**, so it is incompatible with pipelining.
The pipeline throws a fallback error for any `eleven_v3*` model id. It also rejects
`optimize_streaming_latency`, which `server.js` omits for that model family.

**LLM: `gpt-4.1`** (`OPENAI_MODEL`). Note that if this is ever changed to a reasoning
model, reasoning tokens count against `max_output_tokens` in the Responses API, and the
word-limit-to-token estimate above will no longer hold.

---

## Response caching: investigated and rejected

Caching Godfrey's ElevenLabs answers for reuse on similar or identical visitor questions
was assessed and is **not viable**. Visitor phrasing varies too widely for reliable cache
hits, and matching loosely enough to hit often would risk answering a question the visitor
did not ask — unacceptable for an exhibition piece presenting historical testimony.

Latency was addressed by pipelining instead.

---

## Gotchas

- **UTF-8 BOM in JSON config.** `lib/gesture-catalog.js` strips a leading BOM before
  parsing. A BOM in a catalog file otherwise fails `JSON.parse` with a confusing error.
- **Restarts.** `EADDRINUSE` on restart usually means the previous `node server.js` is
  still holding port 3000. Find it with `Get-NetTCPConnection -LocalPort 3000 -State Listen`
  and match the `OwningProcess` before stopping anything.
- **ElevenLabs first-audio buffering.** The service buffers to roughly
  `[120, 160, 250, 290]` characters before emitting audio. The pipeline shortens the first
  bucket, trading a little prosody context for a faster start.
