/**
 * Unreal always-on mic → OpenAI Realtime transcription proxy.
 *
 * Additive path only: does not touch /api/chat, browser Web Speech, or the
 * exhibition TTS queue used by the web UI.
 *
 * Client protocol (ws://host/api/unreal/stt):
 *   → binary frames: raw PCM16 LE mono @ 24 kHz
 *   → JSON text: { type: "control", action: "pause"|"resume"|"clear" }
 *   ← JSON text: speech_started | speech_stopped | transcript_delta |
 *                transcript_completed | transcript_missed | ready | error | openai_event
 *
 * Note: gpt-live-transcribe does NOT support server_vad. Default model is
 * gpt-4o-mini-transcribe (Realtime transcription + server_vad). For
 * gpt-live-transcribe, this proxy runs local RMS VAD and commits turns.
 */

const { WebSocket, WebSocketServer } = require("ws");

const OPENAI_REALTIME_URL =
  process.env.GODFREY_OPENAI_REALTIME_URL ||
  "wss://api.openai.com/v1/realtime?intent=transcription";

// server_vad requires a transcription model that supports turn detection.
// gpt-live-transcribe rejects turn_detection — use local VAD + commit for that model.
const STT_MODEL = process.env.GODFREY_UNREAL_STT_MODEL || "gpt-4o-mini-transcribe";
// Exhibition questions have mid-sentence pauses. 550ms ended the turn while the
// visitor was still talking (lantern Wait / Godfrey answering half a question).
// One-syllable names still commit after this much trailing silence.
const STT_SILENCE_MS = Number(process.env.GODFREY_UNREAL_STT_SILENCE_MS || 1500);
const STT_THRESHOLD = Number(process.env.GODFREY_UNREAL_STT_THRESHOLD || 0.50);
const STT_PREFIX_PADDING_MS = Number(process.env.GODFREY_UNREAL_STT_PREFIX_PADDING_MS || 450);
const STT_NOISE_REDUCTION = String(process.env.GODFREY_UNREAL_STT_NOISE_REDUCTION || "far_field").toLowerCase();
const STT_PATH = "/api/unreal/stt";
const SAMPLE_RATE = 24000;
const LOCAL_VAD_RMS_START = Number(process.env.GODFREY_UNREAL_STT_LOCAL_VAD_START || 0.012);
const LOCAL_VAD_RMS_STOP = Number(process.env.GODFREY_UNREAL_STT_LOCAL_VAD_STOP || 0.006);

/** OpenAI transcription prompt — model sometimes emits this verbatim as a fake transcript. */
const STT_TRANSCRIPTION_PROMPT =
  "Captain John Godfrey exhibition. Transcribe visitor speech in Australian English. " +
  "Visitors often reply with a single short first name only (John, Mary, Tom, Sarah, etc.) — always keep those one-word names. " +
  "Also questions about the SS Georgette shipwreck, Grace Bussell, and the Busselton inquiry.";

const DEFAULT_KEYWORDS = [
  "Georgette",
  "Godfrey",
  "Grace Bussell",
  "Sam Isaacs",
  "Busselton",
  "Fremantle",
  "Western Australia",
  "Hannah Flynn",
  "John",
  "Mary",
  "Tom",
  "Sarah",
  "James",
  "Emma",
];

function normalizeSttTranscript(transcript) {
  return String(transcript || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9'\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSttPromptEcho(transcript) {
  const t = String(transcript || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!t) {
    return true;
  }
  const prompt = STT_TRANSCRIPTION_PROMPT.toLowerCase();
  if (t === prompt) {
    return true;
  }
  // Near-full echoes / truncations of the session prompt (never drop real one-word names).
  if (t.includes("exhibition visitor questions about the ss georgette")) {
    return true;
  }
  if (t.includes("transcribe visitor speech") || t.includes("always keep those one-word names")) {
    return true;
  }
  if (t.includes("captain john godfrey exhibition") && t.includes("australian english")) {
    return true;
  }
  if (prompt.startsWith(t) && t.length >= 48) {
    return true;
  }
  return false;
}

/** gpt-4o-mini-transcribe often invents these on room tone / speaker tail. Keep real names. */
const STT_NOISE_HALLUCINATIONS = new Set([
  "cool",
  "hello",
  "hi",
  "hey",
  "okay",
  "ok",
  "thanks",
  "thank you",
  "you",
  "the",
  "a",
  "and",
  "um",
  "uh",
  "hmm",
  "mm",
  "mhm",
  "music",
  "subtitle",
  "subtitles",
  "applause",
  "thanks for watching",
  "thank you for watching",
]);

function isSttNoiseHallucination(transcript) {
  const t = normalizeSttTranscript(transcript);
  return !t || STT_NOISE_HALLUCINATIONS.has(t);
}

function modelSupportsServerVad(model) {
  const m = String(model || "").toLowerCase();
  // OpenAI rejects turn_detection for gpt-live-transcribe.
  return !m.includes("live-transcribe");
}

function buildSessionUpdate(model) {
  const keywords = String(process.env.GODFREY_UNREAL_STT_KEYWORDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mergedKeywords = [...new Set([...DEFAULT_KEYWORDS, ...keywords])].slice(0, 32);
  const useServerVad = modelSupportsServerVad(model);

  const transcription = {
    model,
    prompt: STT_TRANSCRIPTION_PROMPT,
  };

  if (String(model).includes("live-transcribe")) {
    transcription.keywords = mergedKeywords;
    transcription.languages = ["en"];
    transcription.delay = process.env.GODFREY_UNREAL_STT_DELAY || "low";
  } else {
    transcription.language = "en";
  }

  const input = {
    format: {
      type: "audio/pcm",
      rate: SAMPLE_RATE,
    },
    noise_reduction: {
      type: STT_NOISE_REDUCTION === "near_field" ? "near_field" : "far_field",
    },
    transcription,
    turn_detection: useServerVad
      ? {
          type: "server_vad",
          threshold: Number.isFinite(STT_THRESHOLD) ? STT_THRESHOLD : 0.5,
          prefix_padding_ms: Number.isFinite(STT_PREFIX_PADDING_MS) ? STT_PREFIX_PADDING_MS : 450,
          silence_duration_ms: Number.isFinite(STT_SILENCE_MS) ? STT_SILENCE_MS : 1500,
        }
      : null,
  };

  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input,
      },
    },
  };
}

function pcm16Rms(buf) {
  if (!buf || buf.length < 2) {
    return 0;
  }
  const samples = buf.length / 2;
  let sum = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const sample = buf.readInt16LE(i) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, samples));
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function attachUnrealSttWebSocket(server, { openaiApiKey } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = String(request.url || "").split("?")[0];
    if (pathname !== STT_PATH) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, request);
    });
  });

  wss.on("connection", (clientWs) => {
    const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(clientWs, {
        type: "error",
        error: "OPENAI_API_KEY is not configured for Unreal streaming STT.",
      });
      clientWs.close(1011, "openai_unconfigured");
      return;
    }

    let paused = false;
    let openaiWs = null;
    let closed = false;
    let sessionReady = false;
    const useLocalVad = !modelSupportsServerVad(STT_MODEL);
    let inSpeech = false;
    let silenceStartedAt = null;
    let speechStartedAt = null;
    const silenceMs = Number.isFinite(STT_SILENCE_MS) ? STT_SILENCE_MS : 1500;

    const closeAll = (code = 1000, reason = "closed") => {
      if (closed) {
        return;
      }
      closed = true;
      try {
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.close(code, reason);
        }
      } catch {
        // ignore
      }
      try {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(code, reason);
        }
      } catch {
        // ignore
      }
    };

    const commitLocalTurn = () => {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || !inSpeech) {
        return;
      }
      openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      inSpeech = false;
      silenceStartedAt = null;
      speechStartedAt = null;
      sendJson(clientWs, { type: "speech_stopped", itemId: null, source: "local_vad" });
    };

    const handleLocalVad = (buf) => {
      const rms = pcm16Rms(buf);
      const now = Date.now();
      if (!inSpeech) {
        if (rms >= LOCAL_VAD_RMS_START) {
          inSpeech = true;
          speechStartedAt = now;
          silenceStartedAt = null;
          sendJson(clientWs, { type: "speech_started", itemId: null, source: "local_vad" });
        }
        return;
      }

      if (rms < LOCAL_VAD_RMS_STOP) {
        if (!silenceStartedAt) {
          silenceStartedAt = now;
        } else if (now - silenceStartedAt >= silenceMs) {
          // Require a little speech before committing (avoid clicks).
          if (speechStartedAt && now - speechStartedAt >= 250) {
            commitLocalTurn();
          } else {
            // Too short — clear instead of committing noise.
            openaiWs.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
            inSpeech = false;
            silenceStartedAt = null;
            speechStartedAt = null;
            sendJson(clientWs, { type: "speech_stopped", itemId: null, source: "local_vad_discard" });
          }
        }
      } else {
        silenceStartedAt = null;
      }
    };

    openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    openaiWs.on("open", () => {
      console.log("unreal-stt: OpenAI realtime connected", {
        model: STT_MODEL,
        serverVad: modelSupportsServerVad(STT_MODEL),
        localVad: useLocalVad,
        noiseReduction: STT_NOISE_REDUCTION === "near_field" ? "near_field" : "far_field",
        silenceMs: STT_SILENCE_MS,
        threshold: STT_THRESHOLD,
      });
      openaiWs.send(JSON.stringify(buildSessionUpdate(STT_MODEL)));
    });

    openaiWs.on("message", (data) => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }

      const type = event?.type;
      if (type === "session.updated" || type === "session.created") {
        if (type === "session.updated" && !sessionReady) {
          sessionReady = true;
          sendJson(clientWs, {
            type: "ready",
            model: STT_MODEL,
            sampleRate: SAMPLE_RATE,
            silenceDurationMs: silenceMs,
            turnDetection: useLocalVad ? "local_vad" : "server_vad",
            noiseReduction: STT_NOISE_REDUCTION === "near_field" ? "near_field" : "far_field",
          });
        }
        sendJson(clientWs, { type: "openai_event", eventType: type });
        return;
      }
      if (type === "input_audio_buffer.speech_started") {
        sendJson(clientWs, { type: "speech_started", itemId: event.item_id || null });
        return;
      }
      if (type === "input_audio_buffer.speech_stopped") {
        sendJson(clientWs, { type: "speech_stopped", itemId: event.item_id || null });
        return;
      }
      if (type === "conversation.item.input_audio_transcription.delta") {
        sendJson(clientWs, {
          type: "transcript_delta",
          itemId: event.item_id || null,
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        return;
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (!transcript) {
          console.warn("unreal-stt: empty completed transcript (short speech may need softer VAD)", {
            itemId: event.item_id || null,
          });
          sendJson(clientWs, {
            type: "transcript_missed",
            itemId: event.item_id || null,
            reason: "empty_transcript",
          });
          return;
        }
        if (isSttPromptEcho(transcript)) {
          console.warn("unreal-stt: dropping prompt-echo transcript", { transcript });
          sendJson(clientWs, {
            type: "transcript_missed",
            itemId: event.item_id || null,
            reason: "prompt_echo",
          });
          return;
        }
        if (isSttNoiseHallucination(transcript)) {
          console.warn("unreal-stt: dropping noise-hallucination transcript", { transcript });
          sendJson(clientWs, {
            type: "transcript_missed",
            itemId: event.item_id || null,
            reason: "hallucination",
          });
          return;
        }
        sendJson(clientWs, {
          type: "transcript_completed",
          itemId: event.item_id || null,
          transcript,
        });
        return;
      }
      if (type === "error") {
        console.error("unreal-stt: OpenAI error event", event.error || event);
        sendJson(clientWs, {
          type: "error",
          error: event.error?.message || event.message || "OpenAI realtime error",
          details: event.error || null,
        });
        return;
      }
    });

    openaiWs.on("error", (err) => {
      console.error("unreal-stt: OpenAI websocket error", err?.message || err);
      sendJson(clientWs, {
        type: "error",
        error: err?.message || "OpenAI websocket error",
      });
    });

    openaiWs.on("close", (code, reason) => {
      console.log("unreal-stt: OpenAI websocket closed", {
        code,
        reason: reason?.toString?.() || "",
      });
      if (!closed) {
        sendJson(clientWs, {
          type: "error",
          error: `OpenAI STT connection closed (${code})`,
        });
        closeAll(1011, "openai_closed");
      }
    });

    clientWs.on("message", (data, isBinary) => {
      if (closed) {
        return;
      }

      if (!isBinary) {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          sendJson(clientWs, { type: "error", error: "Invalid JSON control message." });
          return;
        }

        if (msg?.type === "control") {
          const action = String(msg.action || "").toLowerCase();
          if (action === "pause") {
            paused = true;
            inSpeech = false;
            silenceStartedAt = null;
            speechStartedAt = null;
            if (openaiWs?.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
            }
            sendJson(clientWs, { type: "paused", paused: true });
            return;
          }
          if (action === "resume") {
            paused = false;
            sendJson(clientWs, { type: "paused", paused: false });
            return;
          }
          if (action === "clear") {
            inSpeech = false;
            silenceStartedAt = null;
            speechStartedAt = null;
            if (openaiWs?.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
            }
            sendJson(clientWs, { type: "cleared" });
            return;
          }
        }

        sendJson(clientWs, { type: "error", error: "Unknown control message." });
        return;
      }

      if (paused || !sessionReady || openaiWs?.readyState !== WebSocket.OPEN) {
        return;
      }

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length === 0 || buf.length % 2 !== 0) {
        return;
      }

      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: buf.toString("base64"),
        })
      );

      if (useLocalVad) {
        handleLocalVad(buf);
      }
    });

    clientWs.on("close", () => {
      closeAll(1000, "client_closed");
    });

    clientWs.on("error", (err) => {
      console.error("unreal-stt: client websocket error", err?.message || err);
      closeAll(1011, "client_error");
    });
  });

  console.log(
    `Unreal streaming STT websocket ready at ws://localhost:${process.env.PORT || 3000}${STT_PATH} (model=${STT_MODEL})`
  );
  return wss;
}

module.exports = {
  attachUnrealSttWebSocket,
  STT_PATH,
  isSttNoiseHallucination,
  isSttPromptEcho,
};
