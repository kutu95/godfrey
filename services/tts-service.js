const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_turbo_v2_5";

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeElevenLabsSettings(input) {
  return {
    apiKey: typeof input?.apiKey === "string" ? input.apiKey.trim() : "",
    voiceId: typeof input?.voiceId === "string" ? input.voiceId.trim() : "",
    modelId:
      typeof input?.modelId === "string" && input.modelId.trim().length > 0
        ? input.modelId.trim()
        : ELEVENLABS_DEFAULT_MODEL_ID,
    stability: clampNumber(input?.stability, 0, 1, 0.4),
    similarityBoost: clampNumber(input?.similarityBoost, 0, 1, 0.8),
    style: clampNumber(input?.style, 0, 1, 0.3),
    speed: clampNumber(input?.speed, 0.25, 4, 1.0),
    speakerBoost: input?.speakerBoost !== false,
  };
}

function buildElevenLabsVoiceSettings(settings) {
  return {
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,
    style: settings.style,
    speed: settings.speed,
    use_speaker_boost: Boolean(settings.speakerBoost),
  };
}

async function synthesizeOpenAI({ openai, text, model, voice, speed, expressionPrompt, britishAccentBoost, defaultModel, defaultVoice, britishInstructions }) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const inputText = String(text || "").trim().slice(0, 4096);
  if (!inputText) {
    throw new Error("text must be a non-empty string");
  }

  const selectedModel = typeof model === "string" && model.length > 0 ? model : defaultModel;
  const selectedVoice = typeof voice === "string" && voice.length > 0 ? voice : defaultVoice;
  const clampedSpeed = clampNumber(speed, 0.25, 4, 1);
  const stylePrompt = typeof expressionPrompt === "string" ? expressionPrompt.trim() : "";
  const accentBoostEnabled = britishAccentBoost !== false;

  let ttsModel = selectedModel;
  if (accentBoostEnabled && !ttsModel.startsWith("gpt-4o-mini-tts")) {
    ttsModel = defaultModel;
  }

  const ttsRequest = {
    model: ttsModel,
    voice: selectedVoice,
    input: inputText,
    response_format: "mp3",
    speed: clampedSpeed,
  };

  if (ttsModel.startsWith("gpt-4o-mini-tts")) {
    const instructionParts = [];
    if (accentBoostEnabled) {
      instructionParts.push(britishInstructions);
    } else {
      instructionParts.push(
        "Speak as Captain John Godfrey, an English Victorian mariner in late 1876. Use a formal register, measured delivery, and restrained emotional undertone."
      );
    }

    if (stylePrompt.length > 0) {
      instructionParts.push(`Expression guidance: ${stylePrompt}`);
    }

    ttsRequest.instructions = instructionParts.join("\n\n");
  }

  const audioResponse = await openai.audio.speech.create(ttsRequest);
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  return {
    audioBuffer,
    mimeType: "audio/mpeg",
  };
}

async function synthesizeElevenLabs({ text, settings, outputFormat = "mp3_44100_128", accept = "audio/mpeg" }) {
  const inputText = String(text || "").trim().slice(0, 4096);
  if (!inputText) {
    throw new Error("text must be a non-empty string");
  }
  if (!settings.apiKey) {
    throw new Error("ElevenLabs API key is not configured.");
  }
  if (!settings.voiceId) {
    throw new Error("ElevenLabs voice ID is not configured.");
  }

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: accept,
      "Content-Type": "application/json",
      "xi-api-key": settings.apiKey,
    },
    body: JSON.stringify({
      text: inputText,
      model_id: settings.modelId || ELEVENLABS_DEFAULT_MODEL_ID,
      output_format: outputFormat,
      voice_settings: buildElevenLabsVoiceSettings(settings),
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const err = new Error(`ElevenLabs request failed (${response.status}): ${details || response.statusText}`);
    err.statusCode = response.status;
    err.providerDetails = details || response.statusText;
    throw err;
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBuffer,
    mimeType: response.headers.get("content-type") || "audio/mpeg",
  };
}

module.exports = {
  ELEVENLABS_DEFAULT_MODEL_ID,
  sanitizeElevenLabsSettings,
  buildElevenLabsVoiceSettings,
  synthesizeOpenAI,
  synthesizeElevenLabs,
};
