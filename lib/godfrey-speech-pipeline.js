"use strict";

/**
 * Pipelined reply generation for the direct (game mic) speak path.
 *
 * Instead of waiting for the whole LLM reply and then synthesising it, this
 * streams the model's tokens straight into the ElevenLabs WebSocket TTS
 * endpoint, so Godfrey starts speaking while he is still "thinking". The PCM
 * written to the Express response has the same framing and pacing as the
 * non-pipelined HTTP path, so Unreal needs no changes.
 *
 * Anything that goes wrong *before* the first audio byte reaches the client is
 * thrown tagged with code GODFREY_PIPELINE_FALLBACK, so the caller can quietly
 * fall back to the original path. After that point the response is committed
 * and errors propagate normally.
 */

const { WebSocket } = require("ws");
const { createStreamingCueStripper, stripPerformanceCues, parsePerformanceEvents } = require("./performance-text");

const PIPELINE_FALLBACK_CODE = "GODFREY_PIPELINE_FALLBACK";

// ElevenLabs buffers to [120, 160, 250, 290] characters by default before it
// will emit any audio. A shorter first bucket trades a little prosody context
// for time-to-first-word, which is the right way round for a live exhibit.
const CHUNK_LENGTH_SCHEDULE = [50, 120, 160, 290];
const WS_OPEN_TIMEOUT_MS = 5000;
const WS_FINISH_TIMEOUT_MS = 45000;

function pipelineFallback(message) {
  const error = new Error(message);
  error.code = PIPELINE_FALLBACK_CODE;
  return error;
}

function countWords(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Once the word cap is reached we let Godfrey finish the sentence he is in, so a long
// reply trails off on a full stop instead of being guillotined mid-phrase. This bounds
// how far past the cap that grace is allowed to run.
const WORD_CAP_SENTENCE_GRACE_WORDS = 25;

const SENTENCE_END = /[.!?…]["'”’)\]]?$/;
const ABBREVIATION_TAIL = /(?:^|\s)(?:mr|mrs|ms|dr|st|capt|lt|sgt|no|vs|etc)\.$/i;

function endsSentence(text) {
  const trimmed = String(text || "").trimEnd();
  return SENTENCE_END.test(trimmed) && !ABBREVIATION_TAIL.test(trimmed);
}

/**
 * @returns {Promise<{ assistantText: string, totalPcmBytes: number }>}
 */
async function streamGodfreyReplyToPcm({
  res,
  openai,
  requestParams,
  elevenLabs,
  sampleRate,
  frameBytes,
  maxWriteBytes,
  maxWords,
  timing,
  pcmBytesCounter,
}) {
  if (!openai) {
    throw pipelineFallback("OpenAI client is not configured.");
  }
  if (!elevenLabs?.apiKey || !elevenLabs?.voiceId) {
    throw pipelineFallback("ElevenLabs credentials are not configured.");
  }
  if (String(elevenLabs.modelId || "").startsWith("eleven_v3")) {
    throw pipelineFallback("eleven_v3 has no WebSocket endpoint.");
  }

  const endpoint =
    `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenLabs.voiceId)}/stream-input` +
    `?model_id=${encodeURIComponent(elevenLabs.modelId)}&output_format=pcm_${sampleRate}`;

  const ws = new WebSocket(endpoint, { headers: { "xi-api-key": elevenLabs.apiKey } });

  let totalPcmBytes = 0;
  let carry = Buffer.alloc(0);
  let firstPcmTimingLogged = false;
  const writeStepBytes = Math.max(frameBytes, Math.floor(maxWriteBytes / frameBytes) * frameBytes);

  const writeAlignedSlice = async (sub) => {
    if (!Buffer.isBuffer(sub) || sub.length === 0) {
      return;
    }
    if (!firstPcmTimingLogged) {
      firstPcmTimingLogged = true;
      timing?.log?.("first_pcm_write", { totalPcmBytesSoFar: totalPcmBytes, frameBytes, writeStepBytes, pipelined: true });
    }
    totalPcmBytes += sub.length;
    if (pcmBytesCounter) {
      pcmBytesCounter.n += sub.length;
    }
    if (!res.write(sub)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  };

  const flushCarry = async () => {
    const alignedLen = Math.floor(carry.length / frameBytes) * frameBytes;
    if (alignedLen === 0) {
      return;
    }
    const slice = carry.subarray(0, alignedLen);
    carry = carry.subarray(alignedLen);
    for (let offset = 0; offset < slice.length; offset += writeStepBytes) {
      const end = Math.min(offset + writeStepBytes, slice.length);
      // eslint-disable-next-line no-await-in-loop
      await writeAlignedSlice(slice.subarray(offset, end));
    }
  };

  // Audio arrives on a callback that cannot await, so writes are serialised
  // through a promise chain to keep honouring socket backpressure.
  let writeChain = Promise.resolve();
  let writeError = null;
  const enqueueAudio = (buffer) => {
    writeChain = writeChain
      .then(async () => {
        carry = carry.length === 0 ? buffer : Buffer.concat([carry, buffer]);
        await flushCarry();
      })
      .catch((error) => {
        writeError = writeError || error;
      });
  };

  let settled = false;
  let socketError = null;
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  // Nothing awaits `finished` until the model has finished streaming, so without
  // a no-op handler an early socket failure escapes as an unhandled rejection.
  // Awaiting `finished` later still observes the rejection.
  finished.catch(() => {});
  const settleOk = () => {
    if (!settled) {
      settled = true;
      resolveFinished();
    }
  };
  const settleErr = (error) => {
    socketError = socketError || error;
    if (!settled) {
      settled = true;
      rejectFinished(error);
    }
  };
  // Before any audio is out the door a failure is recoverable; after it is not.
  const socketFailure = (message) => (totalPcmBytes === 0 ? pipelineFallback(message) : new Error(message));

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(pipelineFallback("ElevenLabs WebSocket did not open in time.")), WS_OPEN_TIMEOUT_MS);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(pipelineFallback(`ElevenLabs WebSocket error: ${error?.message || error}`));
    });
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.error) {
      settleErr(socketFailure(`ElevenLabs reported: ${message.error}`));
      return;
    }
    if (message.audio) {
      enqueueAudio(Buffer.from(message.audio, "base64"));
    }
    if (message.isFinal) {
      settleOk();
    }
  });
  ws.on("close", () => settleOk());
  ws.on("error", (error) => settleErr(socketFailure(`ElevenLabs WebSocket error: ${error?.message || error}`)));

  try {
    await opened;
  } catch (error) {
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
    throw error;
  }

  const sendToTts = (payload) => {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  };

  sendToTts({
    text: " ",
    voice_settings: elevenLabs.voiceSettings,
    generation_config: { chunk_length_schedule: CHUNK_LENGTH_SCHEDULE },
  });
  timing?.log?.("tts_socket_ready", { modelId: elevenLabs.modelId });

  const stripper = createStreamingCueStripper();
  let assistantText = "";
  let spokenChars = 0;
  let firstTokenLogged = false;
  let llmStream = null;

  try {
    llmStream = await openai.responses.create({ ...requestParams, stream: true });
    for await (const event of llmStream) {
      // Stop generating the moment TTS drops out; there is nowhere to send it.
      if (socketError) {
        throw socketError;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        throw socketFailure("ElevenLabs closed the connection mid-generation.");
      }
      if (event?.type !== "response.output_text.delta") {
        continue;
      }
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) {
        continue;
      }
      if (!firstTokenLogged) {
        firstTokenLogged = true;
        timing?.log?.("llm_first_token");
      }
      assistantText += delta;
      const spoken = stripper.push(delta);
      if (spoken) {
        sendToTts({ text: spoken });
        spokenChars += spoken.length;
      }
      if (maxWords) {
        const words = countWords(assistantText);
        if (words >= maxWords + WORD_CAP_SENTENCE_GRACE_WORDS) {
          timing?.log?.("llm_word_cap_reached", { maxWords, words, sentenceComplete: false });
          break;
        }
        if (words >= maxWords && endsSentence(assistantText)) {
          timing?.log?.("llm_word_cap_reached", { maxWords, words, sentenceComplete: true });
          break;
        }
      }
    }
  } catch (error) {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    if (error?.code === PIPELINE_FALLBACK_CODE) {
      throw error;
    }
    if (totalPcmBytes === 0) {
      throw pipelineFallback(`LLM stream failed: ${error?.message || error}`);
    }
    throw error;
  } finally {
    // Breaking out at the word cap leaves the HTTP stream open otherwise.
    try {
      llmStream?.controller?.abort();
    } catch {
      /* nothing to abort */
    }
  }

  if (socketError) {
    throw socketError;
  }

  const tail = stripper.flush();
  if (tail.trim()) {
    sendToTts({ text: tail });
    spokenChars += tail.length;
  }
  timing?.log?.("llm_done", { assistantChars: assistantText.length, spokenChars });

  if (spokenChars === 0) {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    throw pipelineFallback("Model produced no speakable text.");
  }

  // An empty string flushes whatever is buffered and closes the socket.
  sendToTts({ text: "" });

  const finishTimer = setTimeout(() => settleErr(socketFailure("Timed out waiting for ElevenLabs audio.")), WS_FINISH_TIMEOUT_MS);
  try {
    await finished;
  } finally {
    clearTimeout(finishTimer);
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {
      /* already gone */
    }
  }

  await writeChain;
  if (writeError) {
    throw writeError;
  }
  if (totalPcmBytes === 0) {
    throw pipelineFallback("ElevenLabs closed without returning audio.");
  }

  if (carry.length > 0) {
    const pad = (frameBytes - (carry.length % frameBytes)) % frameBytes;
    carry = pad === 0 ? carry : Buffer.concat([carry, Buffer.alloc(pad, 0)]);
    await flushCarry();
  }

  const performanceText = assistantText.trim();
  console.log("PERFORMANCE_TEXT_FOR_UNREAL", performanceText);
  console.log("SPOKEN_TEXT_FOR_ELEVENLABS", stripPerformanceCues(performanceText));
  console.log("PERFORMANCE_EVENTS_PARSED", JSON.stringify(parsePerformanceEvents(performanceText)));

  res.end();
  timing?.log?.("last_pcm_write", { totalPcmBytes });
  console.log("Total PCM bytes sent", { totalPcmBytes, pipelined: true });

  return { assistantText: performanceText, totalPcmBytes };
}

module.exports = {
  streamGodfreyReplyToPcm,
  PIPELINE_FALLBACK_CODE,
  WORD_CAP_SENTENCE_GRACE_WORDS,
};
