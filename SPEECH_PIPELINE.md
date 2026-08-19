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

## Reply length and the word cap

The cap lives in `response-config.json` (`maxWords`, currently **80**), editable from the
admin UI.

The pipeline used to break the LLM stream the instant the running word count reached the
cap, wherever that happened to land. On 2026-08-01 this produced a reply ending
`"...can't stop progress. You prefer one"` — cut mid-question, and the audio faithfully
spoke the truncation. It sounds like a crash, not a word limit.

The cap now lets Godfrey finish the sentence he is in:

- Past `maxWords`, keep streaming until the text ends on sentence punctuation.
- Hard ceiling of `WORD_CAP_SENTENCE_GRACE_WORDS` (25) past the cap so a rambling reply
  cannot run away.
- An abbreviation guard prevents `"He sailed with Capt."` being mistaken for a sentence end.

**The OpenAI token budget must cover the grace window.** `buildGodfreyOpenAIRequestParams`
budgets for `maxWords + WORD_CAP_SENTENCE_GRACE_WORDS`. If it budgets only for `maxWords`,
the API-level `max_output_tokens` cap binds first and reproduces the exact mid-phrase cut
the grace exists to prevent.

Related constants in `server.js`: `estimateTokenBudgetFromWordLimit` assumes 2.2 tokens per
word, with a hard ceiling of `MAX_RESPONSE_TOKENS` (420).

The non-pipelined path is separate and uses `limitResponseToWordCount`, which truncates and
appends an admin notice. It does not have sentence grace.

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
