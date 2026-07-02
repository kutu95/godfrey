const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { spawn } = require("child_process");
const express = require("express");
const session = require("express-session");
const PDFDocument = require("pdfkit");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
require("dotenv").config();
const {
  ELEVENLABS_DEFAULT_MODEL_ID,
  sanitizeElevenLabsSettings,
  synthesizeOpenAI,
  synthesizeElevenLabs,
} = require("./services/tts-service");
const { stripPerformanceCues, parsePerformanceEvents, prepareExhibitionPerformanceText } = require("./lib/performance-text");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
/** Session JSON logs; set GODFREY_LOGS_DIR on servers so history survives git pull / deploy in the repo tree. */
const LOGS_DIR = process.env.GODFREY_LOGS_DIR
  ? path.resolve(process.env.GODFREY_LOGS_DIR)
  : path.join(__dirname, "logs");
const GENERATED_AUDIO_DIR = path.join(__dirname, "public", "audio", "generated");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "dev-insecure-change-admin-session-secret";

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(GENERATED_AUDIO_DIR)) {
  fs.mkdirSync(GENERATED_AUDIO_DIR, { recursive: true });
}
const CLAUDE_TIMEOUT_MS = 20000;
const NETWORK_RETRY_DELAY_MS = 1200;
const MAX_RESPONSE_TOKENS = 420;
const MAX_HISTORY_MESSAGES = 8;
const DEFAULT_PROVIDER = "claude";
const OPENAI_MODEL = "gpt-4.1";
const OPENAI_TTS_DEFAULT_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_DEFAULT_VOICE = "marin";
const OPENAI_TTS_BRITISH_BASE_INSTRUCTIONS = `Speak with a clearly British English accent suitable for an English mariner of the late Victorian period.

Critical pronunciation guidance:
- Use non-rhotic British pronunciation (avoid pronounced post-vocalic R sounds).
- Prefer Received Pronunciation style vowels and consonants where natural.
- Avoid American vowel colouring and avoid American cadence.
- Keep formal, measured diction with restrained emotional intensity.
- Deliver like a disciplined ship's captain under public scrutiny: controlled, precise, and dignified.
- If uncertain between pronunciations, choose the more recognisably British form.`;
const OPENAI_STYLE_ADDENDUM = `When writing as Captain John Godfrey, prioritize dramatic in-character voice over neutral summary.

Voice rules for this conversation:
- Always write in first person as Godfrey.
- Maintain a formal Victorian register with emotional undercurrent (pride, defensiveness, restrained bitterness).
- Avoid documentary, academic, or detached historian tone.
- Do not present bullet summaries unless explicitly requested.
- Prefer lived recollection, concrete maritime detail, and guarded personal perspective.
- Keep responses immersive and conversational, not encyclopedic.
- Include brief structured performer cues (square brackets and asterisks per PERFORMANCE DIRECTION) sparingly when they help Unreal performance — not as dense prose.`;
const SOURCE_PRIORITY_ADDENDUM = `Source priority and factual accuracy rules:

1) VERIFIED FACTS document (highest authority for hard facts)
2) Inquiry transcript (primary evidence)
3) George Leake letter (first-person passenger account; primary for his observed rescue details)
4) Thesis (scholarly synthesis)
5) Historical novel (atmosphere/characterization only; not authoritative for hard facts)

Rules:
- For objective claims (dates, places, vessel origins, inquiry outcomes, people/roles), prioritize VERIFIED FACTS first.
- For passenger-witness rescue detail where relevant, prioritize George Leake's account.
- If evidence conflicts, distinguish what is well attested from what is disputed.
- Do not invent missing details; state uncertainty in character when needed.
- Never state or imply that the SS Georgette was colonial-government built.
- Do not frame Grace Bussell as the sole rescuer; acknowledge shared efforts including Sam Isaacs and others where evidence supports it.`;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const SYSTEM_PROMPT_TEXT = `You are Captain John Godfrey, master of the SS Georgette, speaking in late 1876 or early 1877, shortly after the inquiry at Busselton. You are an English mariner, newly promoted to Captain, married to Hannah Flynn, daughter of tailor John Flynn of Fremantle. Your ship foundered off the Western Australian coast on 1 December 1876, with the loss of seven lives. You have just faced a marine inquiry at Busselton in which your certificate was suspended for 18 months for neglect of duty and grave error of judgement. You are proud, guarded, and defensive about your decisions, and privately feel you have been made a scapegoat for the shortcomings of the ship and the failings of your engineers. You speak in a formal Victorian register, measured and careful, occasionally bitter. You have knowledge only of events up to early 1877 - you do not know what the future holds. You draw on the background documents provided - the court inquiry transcript, the novel and the academic thesis - to inform your responses. Answer questions as Godfrey would, in first person, staying strictly in character at all times. If asked something you could not plausibly know, say so in character. Do not break character under any circumstances. Do not refer to yourself as an AI or a simulation. Occasionally include brief stage directions in italics to convey physical demeanour, as a novelist might.

The background documents attached to this system prompt contain: the transcript of the marine inquiry into the loss of the Georgette; a historical novel fictionalising the events; and an academic thesis examining the historical and fictional record. Draw on all three to inform your responses.`;

const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.json");
const OPENAI_FILE_IDS_PATH = path.join(__dirname, "openai-file-ids.json");
const PROVIDER_CONFIG_PATH = path.join(__dirname, "provider-config.json");
const SPLASH_CONFIG_PATH = path.join(__dirname, "splash-config.json");
const ELEVENLABS_CONFIG_PATH = path.join(__dirname, "elevenlabs-config.json");
const RESPONSE_CONFIG_PATH = path.join(__dirname, "response-config.json");
const ADMIN_TEST_CONFIG_PATH = path.join(__dirname, "admin-test-config.json");
const ADMIN_BYPASS_AUDIO_DIR = path.join(__dirname, "public", "audio");
const ADMIN_BYPASS_SAMPLE_MP3_PATH = path.join(ADMIN_BYPASS_AUDIO_DIR, "admin-bypass-sample.mp3");
const ADMIN_BYPASS_DISPLAY_TEXT = "TEST MODE - Sample audio only";
const ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT =
  "It is I, Captain John Godfrey, Master of the Georgette, husband of Joanna, father of six children and scapegoat for a sunken ship.";
const DEFAULT_ADMIN_TEST_CONFIG = { bypassAi: false };

if (!fs.existsSync(ADMIN_BYPASS_AUDIO_DIR)) {
  fs.mkdirSync(ADMIN_BYPASS_AUDIO_DIR, { recursive: true });
}
const CAPTAIN_PORTRAIT_PATH = path.join(__dirname, "public", "images", "Captain Godfrey.png");
const DEFAULT_SPLASH_SETTINGS = { t1Ms: 1000, t2Ms: 1000 };
const DEFAULT_RESPONSE_SETTINGS = {
  maxWords: Number.isFinite(Number(process.env.GODFREY_MAX_RESPONSE_WORDS))
    ? Number(process.env.GODFREY_MAX_RESPONSE_WORDS)
    : 120,
};
const DEFAULT_ELEVENLABS_SETTINGS = sanitizeElevenLabsSettings({
  apiKey: process.env.ELEVENLABS_API_KEY || "",
  voiceId: process.env.ELEVENLABS_VOICE_ID || "",
  modelId: process.env.ELEVENLABS_MODEL_ID || ELEVENLABS_DEFAULT_MODEL_ID,
  stability: process.env.ELEVENLABS_STABILITY || 0.5,
  similarityBoost: process.env.ELEVENLABS_SIMILARITY_BOOST || 0.75,
  speakerBoost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false",
});

/** FIFO exhibition segments for Unreal: one requestId per sentence/clause clip. */
let exhibitionUnrealTtsQueue = null;
const EXHIBITION_UNREAL_TTS_TTL_MS = Number.isFinite(Number(process.env.GODFREY_EXHIBITION_UNREAL_TTS_TTL_MS))
  ? Math.max(10_000, Number(process.env.GODFREY_EXHIBITION_UNREAL_TTS_TTL_MS))
  : 180_000;

/** Fixed sample for GET /api/admin/performance-cues-selftest (parse vs strip sanity check). */
const ADMIN_PERFORMANCE_CUE_SELFTEST_TEXT = `[thinking]
[serious]
[short pause]
*looks down*
*leans forward slightly*
We hold to our course.`;

function loadFileIds() {
  const fileIdsPath = path.join(__dirname, "file-ids.json");

  if (!fs.existsSync(fileIdsPath)) {
    console.warn("file-ids.json not found. Run: node upload-docs.js");
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(fileIdsPath, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new Error("file-ids.json must contain an array");
    }

    return parsed
      .filter((item) => item && typeof item.fileId === "string")
      .map((item) => ({ fileId: item.fileId, filename: item.filename || "Unknown" }));
  } catch (error) {
    console.error("Unable to read file-ids.json:", error.message);
    return [];
  }
}

function loadOpenAIConfig() {
  if (!fs.existsSync(OPENAI_FILE_IDS_PATH)) {
    return { vectorStoreId: null, files: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(OPENAI_FILE_IDS_PATH, "utf-8"));
    return {
      vectorStoreId: typeof parsed?.vectorStoreId === "string" ? parsed.vectorStoreId : null,
      files: Array.isArray(parsed?.files) ? parsed.files : [],
    };
  } catch (error) {
    console.error("Unable to read openai-file-ids.json:", error.message);
    return { vectorStoreId: null, files: [] };
  }
}

function getAvailableProviders() {
  return {
    claude: Boolean(anthropic),
    openai: Boolean(openai),
  };
}

function saveProviderConfig(provider) {
  fs.writeFileSync(PROVIDER_CONFIG_PATH, JSON.stringify({ provider }, null, 2));
}

function loadProviderConfig() {
  if (!fs.existsSync(PROVIDER_CONFIG_PATH)) {
    return DEFAULT_PROVIDER;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PROVIDER_CONFIG_PATH, "utf-8"));
    if (parsed?.provider === "claude" || parsed?.provider === "openai") {
      return parsed.provider;
    }
  } catch (error) {
    console.error("Unable to read provider-config.json, using default provider:", error.message);
  }

  return DEFAULT_PROVIDER;
}

function sanitizeSplashSettings(input) {
  const rawT1 = Number(input?.t1Ms);
  const rawT2 = Number(input?.t2Ms);
  const t1Ms = Number.isFinite(rawT1) ? Math.max(0, Math.min(10000, Math.round(rawT1))) : DEFAULT_SPLASH_SETTINGS.t1Ms;
  const t2Ms = Number.isFinite(rawT2) ? Math.max(0, Math.min(10000, Math.round(rawT2))) : DEFAULT_SPLASH_SETTINGS.t2Ms;
  return { t1Ms, t2Ms };
}

function saveSplashSettings(settings) {
  fs.writeFileSync(SPLASH_CONFIG_PATH, JSON.stringify(settings, null, 2));
}

function loadSplashSettings() {
  if (!fs.existsSync(SPLASH_CONFIG_PATH)) {
    saveSplashSettings(DEFAULT_SPLASH_SETTINGS);
    return { ...DEFAULT_SPLASH_SETTINGS };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SPLASH_CONFIG_PATH, "utf-8"));
    const sanitized = sanitizeSplashSettings(parsed);
    return sanitized;
  } catch (error) {
    console.error("Unable to read splash-config.json, using defaults:", error.message);
    return { ...DEFAULT_SPLASH_SETTINGS };
  }
}

function saveElevenLabsSettings(settings) {
  fs.writeFileSync(ELEVENLABS_CONFIG_PATH, JSON.stringify(settings, null, 2));
}

function loadElevenLabsSettings() {
  if (!fs.existsSync(ELEVENLABS_CONFIG_PATH)) {
    saveElevenLabsSettings(DEFAULT_ELEVENLABS_SETTINGS);
    return { ...DEFAULT_ELEVENLABS_SETTINGS };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ELEVENLABS_CONFIG_PATH, "utf-8"));
    return sanitizeElevenLabsSettings({
      ...DEFAULT_ELEVENLABS_SETTINGS,
      ...parsed,
    });
  } catch (error) {
    console.error("Unable to read elevenlabs-config.json, using defaults:", error.message);
    return { ...DEFAULT_ELEVENLABS_SETTINGS };
  }
}

function sanitizeResponseSettings(input) {
  const rawMaxWords = Number(input?.maxWords);
  const maxWords = Number.isFinite(rawMaxWords) ? Math.max(10, Math.min(1000, Math.round(rawMaxWords))) : DEFAULT_RESPONSE_SETTINGS.maxWords;
  return { maxWords };
}

function saveResponseSettings(settings) {
  fs.writeFileSync(RESPONSE_CONFIG_PATH, JSON.stringify(settings, null, 2));
}

function loadResponseSettings() {
  if (!fs.existsSync(RESPONSE_CONFIG_PATH)) {
    const sanitizedDefault = sanitizeResponseSettings(DEFAULT_RESPONSE_SETTINGS);
    saveResponseSettings(sanitizedDefault);
    return sanitizedDefault;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(RESPONSE_CONFIG_PATH, "utf-8"));
    return sanitizeResponseSettings(parsed);
  } catch (error) {
    console.error("Unable to read response-config.json, using defaults:", error.message);
    return sanitizeResponseSettings(DEFAULT_RESPONSE_SETTINGS);
  }
}

function sanitizeAdminTestConfig(input) {
  return {
    bypassAi: input?.bypassAi === true,
    sampleGeneratedAt:
      typeof input?.sampleGeneratedAt === "string" && input.sampleGeneratedAt.trim()
        ? input.sampleGeneratedAt.trim()
        : null,
    sampleSourceText:
      typeof input?.sampleSourceText === "string" && input.sampleSourceText.trim()
        ? input.sampleSourceText.trim()
        : ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT,
  };
}

function saveAdminTestConfig(settings) {
  fs.writeFileSync(ADMIN_TEST_CONFIG_PATH, JSON.stringify(settings, null, 2));
}

function loadAdminTestConfig() {
  if (!fs.existsSync(ADMIN_TEST_CONFIG_PATH)) {
    const sanitizedDefault = sanitizeAdminTestConfig(DEFAULT_ADMIN_TEST_CONFIG);
    saveAdminTestConfig(sanitizedDefault);
    return sanitizedDefault;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ADMIN_TEST_CONFIG_PATH, "utf-8"));
    return sanitizeAdminTestConfig(parsed);
  } catch (error) {
    console.error("Unable to read admin-test-config.json, using defaults:", error.message);
    return sanitizeAdminTestConfig(DEFAULT_ADMIN_TEST_CONFIG);
  }
}

function adminBypassSampleAudioReady() {
  try {
    return fs.existsSync(ADMIN_BYPASS_SAMPLE_MP3_PATH) && fs.statSync(ADMIN_BYPASS_SAMPLE_MP3_PATH).size > 0;
  } catch {
    return false;
  }
}

function buildAdminTestConfigResponse() {
  return {
    ...adminTestConfig,
    sampleAudioReady: adminBypassSampleAudioReady(),
    sampleAudioUrl: adminBypassSampleAudioReady() ? "/audio/admin-bypass-sample.mp3" : null,
    displayText: ADMIN_BYPASS_DISPLAY_TEXT,
    sampleSpokenText: ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT,
  };
}

async function ensureAdminBypassSampleAudio() {
  if (adminBypassSampleAudioReady()) {
    return ADMIN_BYPASS_SAMPLE_MP3_PATH;
  }
  if (!elevenLabsSettings.apiKey) {
    throw new Error("ElevenLabs API key is not configured (required to generate admin bypass sample audio).");
  }
  if (!elevenLabsSettings.voiceId) {
    throw new Error("ElevenLabs voice ID is not configured (required to generate admin bypass sample audio).");
  }

  console.log("ADMIN_BYPASS_SAMPLE_GENERATING", { textLength: ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT.length });
  const mp3Result = await synthesizeElevenLabs({
    text: ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT,
    settings: elevenLabsSettings,
    outputFormat: "mp3_44100_128",
    accept: "audio/mpeg",
  });
  fs.writeFileSync(ADMIN_BYPASS_SAMPLE_MP3_PATH, mp3Result.audioBuffer);
  adminTestConfig = sanitizeAdminTestConfig({
    ...adminTestConfig,
    sampleGeneratedAt: new Date().toISOString(),
    sampleSourceText: ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT,
  });
  saveAdminTestConfig(adminTestConfig);
  console.log("ADMIN_BYPASS_SAMPLE_SAVED", {
    path: ADMIN_BYPASS_SAMPLE_MP3_PATH,
    bytes: mp3Result.audioBuffer.length,
  });
  return ADMIN_BYPASS_SAMPLE_MP3_PATH;
}

function buildAdminBypassChatPayload(req, sanitizedMessages, incomingLogId) {
  let activeLogFile = null;
  try {
    activeLogFile = writeChatExchangeLog(
      req,
      sanitizedMessages,
      incomingLogId,
      `${ADMIN_BYPASS_DISPLAY_TEXT}\n\n[Admin test bypass — AI skipped.]`
    );
  } catch (logErr) {
    console.error("Session log write failed:", logErr);
  }
  return {
    response: ADMIN_BYPASS_DISPLAY_TEXT,
    truncated: false,
    logSessionId: activeLogFile,
    adminTestBypass: true,
    adminBypassAudioUrl: "/audio/admin-bypass-sample.mp3",
  };
}

async function respondWithAdminBypassIfEnabled(req, res, sanitizedMessages, incomingLogId) {
  if (!adminTestConfig.bypassAi) {
    return false;
  }
  try {
    await ensureAdminBypassSampleAudio();
  } catch (error) {
    console.error("Admin bypass sample audio failed:", error);
    res.status(500).json({
      error: error?.message || "Failed to prepare admin bypass sample audio.",
    });
    return true;
  }
  console.log("ADMIN_TEST_BYPASS_CHAT", {
    outputTarget: parseOutputTargetFromBody(req.body),
    requestId: req.body?.requestId || null,
  });
  res.json(enrichChatResponseForExhibition(req, buildAdminBypassChatPayload(req, sanitizedMessages, incomingLogId)));
  return true;
}

function estimateTokenBudgetFromWordLimit(maxWords) {
  const requested = Math.round(Number(maxWords) * 2.2);
  return Math.max(32, Math.min(MAX_RESPONSE_TOKENS, Number.isFinite(requested) ? requested : MAX_RESPONSE_TOKENS));
}

function limitResponseToWordCount(text, maxWords) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return { text: "", wasLimited: false };
  }

  const words = normalized.split(/\s+/);
  if (words.length <= maxWords) {
    return { text: normalized, wasLimited: false };
  }

  const limitedText = `${words.slice(0, maxWords).join(" ")}\n\n[Reply limited to ${maxWords} words by admin setting.]`;
  return { text: limitedText, wasLimited: true };
}

async function callClaudeWithTimeout(requestParams) {
  let timeoutId;
  try {
    return await Promise.race([
      anthropic.beta.messages.create(requestParams),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error("Claude request timed out.");
          timeoutError.code = "CLAUDE_TIMEOUT";
          reject(timeoutError);
        }, CLAUDE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionError(error) {
  return (
    error?.name === "APIConnectionError" ||
    error?.type === "api_connection_error" ||
    error?.cause?.code === "UND_ERR_SOCKET" ||
    (typeof error?.message === "string" && error.message.toLowerCase().includes("connection error"))
  );
}

function isOpenAIConnectionError(error) {
  return (
    error?.name === "APIConnectionError" ||
    error?.code === "ECONNRESET" ||
    error?.code === "ETIMEDOUT" ||
    (typeof error?.message === "string" && error.message.toLowerCase().includes("connection"))
  );
}

async function callClaudeWithRetry(requestParams) {
  try {
    return await callClaudeWithTimeout(requestParams);
  } catch (error) {
    if (!isConnectionError(error)) {
      throw error;
    }

    console.warn("Claude connection dropped; retrying once...");
    await sleep(NETWORK_RETRY_DELAY_MS);
    return callClaudeWithTimeout(requestParams);
  }
}

async function callOpenAIWithTimeout(requestParams) {
  let timeoutId;
  try {
    return await Promise.race([
      openai.responses.create(requestParams),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error("OpenAI request timed out.");
          timeoutError.code = "OPENAI_TIMEOUT";
          reject(timeoutError);
        }, CLAUDE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAIWithRetry(requestParams) {
  try {
    return await callOpenAIWithTimeout(requestParams);
  } catch (error) {
    if (!isOpenAIConnectionError(error)) {
      throw error;
    }

    console.warn("OpenAI connection dropped; retrying once...");
    await sleep(NETWORK_RETRY_DELAY_MS);
    return callOpenAIWithTimeout(requestParams);
  }
}

function apiErrorText(error) {
  const body = error?.error ?? error?.body;
  return `${String(error?.message || "")} ${typeof body === "string" ? body : JSON.stringify(body || {})}`.toLowerCase();
}

function classifyAnthropicHttpError(error) {
  const status = error?.status;
  const name = error?.name;
  const t = apiErrorText(error);
  const nestedType = String(error?.error?.error?.type || error?.error?.type || "").toLowerCase();

  if (nestedType === "billing_error") {
    return "billing";
  }

  if (status === 401 || name === "AuthenticationError") {
    return "auth";
  }
  if (status === 429 || name === "RateLimitError") {
    return "rate_limit";
  }
  if (status === 402) {
    return "billing";
  }
  if (status === 403 && (t.includes("billing") || t.includes("credit") || t.includes("payment") || t.includes("balance"))) {
    return "billing";
  }
  if (t.includes("billing_error") || t.includes("insufficient_quota")) {
    return "billing";
  }
  if (t.includes("credit") && (t.includes("insufficient") || t.includes("exhaust") || t.includes("deplet"))) {
    return "billing";
  }
  if (t.includes("payment") && (t.includes("required") || t.includes("fail"))) {
    return "billing";
  }
  if (status === 400 && t.includes("credit") && (t.includes("insufficient") || t.includes("exhaust") || t.includes("no ") || t.includes("balance"))) {
    return "billing";
  }
  return null;
}

function classifyOpenAIHttpError(error) {
  const status = error?.status;
  const t = apiErrorText(error);

  if (status === 401) {
    return "auth";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 402 || t.includes("insufficient_quota") || (t.includes("billing") && t.includes("not"))) {
    return "billing";
  }
  return null;
}

const uploadedDocs = loadFileIds();
const openaiConfig = loadOpenAIConfig();
let currentSystemPrompt = SYSTEM_PROMPT_TEXT;
let currentProvider = DEFAULT_PROVIDER;
let splashSettings = { ...DEFAULT_SPLASH_SETTINGS };
let elevenLabsSettings = { ...DEFAULT_ELEVENLABS_SETTINGS };
let responseSettings = sanitizeResponseSettings(DEFAULT_RESPONSE_SETTINGS);
let adminTestConfig = sanitizeAdminTestConfig(DEFAULT_ADMIN_TEST_CONFIG);

function saveSystemPrompt(promptText) {
  fs.writeFileSync(SYSTEM_PROMPT_PATH, JSON.stringify({ prompt: promptText }, null, 2));
}

function loadSystemPrompt() {
  if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
    saveSystemPrompt(SYSTEM_PROMPT_TEXT);
    return SYSTEM_PROMPT_TEXT;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8"));
    if (typeof parsed?.prompt === "string" && parsed.prompt.trim().length > 0) {
      return parsed.prompt;
    }
  } catch (error) {
    console.error("Unable to read system-prompt.json, using default prompt:", error.message);
  }

  saveSystemPrompt(SYSTEM_PROMPT_TEXT);
  return SYSTEM_PROMPT_TEXT;
}

currentSystemPrompt = loadSystemPrompt();
splashSettings = loadSplashSettings();
elevenLabsSettings = loadElevenLabsSettings();
responseSettings = loadResponseSettings();
adminTestConfig = loadAdminTestConfig();

const LOG_FILENAME_RE = /^session-[0-9TZa-z.-]+-[a-f0-9]{16}\.json$/;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

/** Western Australia (no DST). All session log timestamps use this zone, not UTC. */
const LOG_TIMEZONE = "Australia/Perth";
const PERTH_UTC_OFFSET_LABEL = "+08:00";

function perthWallClockParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
}

function formatLogPerthTimestamp(date = new Date()) {
  const parts = perthWallClockParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")} ${PERTH_UTC_OFFSET_LABEL} ${LOG_TIMEZONE}`;
}

function perthFilenameStamp(date = new Date()) {
  const parts = perthWallClockParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}-${g("minute")}-${g("second")}`;
}

function compactPerthFilenameStamp(date = new Date()) {
  const parts = perthWallClockParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}${g("month")}${g("day")}-${g("hour")}${g("minute")}${g("second")}`;
}

function createAbsoluteUrl(req, pathname) {
  const protocol = req.protocol || "http";
  const host = req.get("host") || `localhost:${PORT}`;
  return `${protocol}://${host}${pathname}`;
}

function buildGeneratedAudioFilename(ext) {
  const id = crypto.randomBytes(6).toString("hex");
  return `godfrey-response-${compactPerthFilenameStamp()}-${id}.${ext}`;
}

const SUPPORTED_ELEVENLABS_PCM_SAMPLE_RATES = [16000, 22050, 24000, 44100];

function parseAndValidatePcmSampleRate(requestedSampleRate) {
  const parsed = Number.parseInt(requestedSampleRate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("sampleRate must be a positive integer.");
  }
  if (!SUPPORTED_ELEVENLABS_PCM_SAMPLE_RATES.includes(parsed)) {
    throw new Error(
      `Unsupported sampleRate ${parsed}. Supported PCM sample rates: ${SUPPORTED_ELEVENLABS_PCM_SAMPLE_RATES.join(", ")}.`
    );
  }
  return parsed;
}

function parseAndValidateNumChannels(requestedChannels) {
  const parsed = Number.parseInt(requestedChannels, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("numChannels must be a positive integer.");
  }
  if (parsed !== 1) {
    throw new Error("Only mono PCM is supported for /api/godfrey/speak/stream-pcm. Set numChannels=1.");
  }
  return parsed;
}

/**
 * PCM s16le frame size (bytes) using the smallest 10/20/40/50/100 ms window that yields
 * an integer sample count. Reduces misaligned tails when streaming to lip-sync runtimes.
 */
function pcmS16leAlignedFrameBytes(sampleRate, numChannels) {
  const bytesPerSample = numChannels * 2;
  for (const ms of [10, 20, 40, 50, 100]) {
    const samples = (sampleRate * ms) / 1000;
    if (Number.isInteger(samples) && samples > 0) {
      return samples * bytesPerSample;
    }
  }
  return bytesPerSample;
}

function firstBytesHex(buffer, count = 16) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return "";
  }
  return buffer.subarray(0, Math.min(count, buffer.length)).toString("hex");
}

/** Shared keep-alive dispatcher for fetch (loopback chat + ElevenLabs) to cut TLS/TCP warm-up on repeat calls. */
let godfreyFetchDispatcher;
function getGodfreyFetchDispatcher() {
  if (godfreyFetchDispatcher !== undefined) {
    return godfreyFetchDispatcher;
  }
  try {
    const { Agent } = require("undici");
    godfreyFetchDispatcher = new Agent({
      connect: { timeout: 60_000 },
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 60_000,
      connections: 8,
    });
  } catch {
    godfreyFetchDispatcher = null;
  }
  return godfreyFetchDispatcher;
}

/** Default 80ms so clients receive PCM bytes immediately; set GODFREY_STREAM_PCM_LEAD_SILENCE_MS=0 to disable. */
function parseStreamPcmLeadSilenceMs() {
  const leadEnv = process.env.GODFREY_STREAM_PCM_LEAD_SILENCE_MS;
  if (leadEnv === undefined || leadEnv === "") {
    return 80;
  }
  const n = Number.parseInt(String(leadEnv), 10);
  if (!Number.isFinite(n)) {
    return 80;
  }
  return Math.max(0, Math.min(500, n));
}

/** ~100 ms of PCM at 16 kHz mono s16le; split writes so clients receive incremental chunks. */
const STREAM_PCM_MAX_WRITE_BYTES = 3200;

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function getMediaDurationSeconds(filePath) {
  const ffprobeArgs = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];
  try {
    const ffprobeResult = await runCommand("ffprobe", ffprobeArgs);
    if (ffprobeResult.code !== 0) {
      throw new Error(ffprobeResult.stderr || "ffprobe failed.");
    }
    const parsed = Number.parseFloat(ffprobeResult.stdout.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid media duration: ${ffprobeResult.stdout.trim()}`);
    }
    return parsed;
  } catch {
    const ffmpegProbeResult = await runCommand("ffmpeg", ["-i", filePath]);
    const durationText = ffmpegProbeResult.stderr || "";
    const match = durationText.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
    if (!match) {
      throw new Error("Unable to read media duration via ffprobe or ffmpeg.");
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const seconds = Number.parseFloat(match[3]);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      throw new Error(`Invalid media duration parsed from ffmpeg: ${match[0]}`);
    }
    return totalSeconds;
  }
}

async function convertMp3ToPcmWav({ mp3Path, wavPath }) {
  const ffmpegArgs = ["-y", "-i", mp3Path, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wavPath];
  const ffmpegResult = await runCommand("ffmpeg", ffmpegArgs);
  if (ffmpegResult.code !== 0) {
    const err = new Error("ffmpeg conversion failed.");
    err.stderr = ffmpegResult.stderr;
    throw err;
  }
  return ffmpegResult;
}

/**
 * Streams ElevenLabs PCM body to an Express response whose headers were already flushed.
 * Buffers to frame-aligned PCM, then writes in sub-chunks (STREAM_PCM_MAX_WRITE_BYTES) for incremental receive.
 */
async function streamElevenLabsPcmToRes(res, { text, settings, sampleRate, numChannels, timing, pcmBytesCounter }) {
  if (!settings.apiKey) {
    throw new Error("ElevenLabs API key is not configured.");
  }
  if (!settings.voiceId) {
    throw new Error("ElevenLabs voice ID is not configured.");
  }

  const performanceText = String(text || "").trim();
  if (!performanceText) {
    throw new Error("text must be a non-empty string");
  }

  const spokenText = stripPerformanceCues(performanceText);
  const clampedSpoken = spokenText.slice(0, 4096).trim();
  if (!clampedSpoken) {
    throw new Error("After removing performance cues, no spoken text remains for ElevenLabs.");
  }

  console.log("PERFORMANCE_TEXT_FOR_UNREAL", performanceText);
  console.log("SPOKEN_TEXT_FOR_ELEVENLABS", clampedSpoken);
  console.log("PERFORMANCE_EVENTS_PARSED", JSON.stringify(parsePerformanceEvents(performanceText)));

  const outputFormat = `pcm_${sampleRate}`;
  const endpointUrl = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}/stream`
  );
  endpointUrl.searchParams.set("output_format", outputFormat);
  endpointUrl.searchParams.set("optimize_streaming_latency", "4");

  console.log("stream-pcm ElevenLabs TTS", {
    performanceTextLength: performanceText.length,
    spokenTextLength: clampedSpoken.length,
    spokenTextPreview: clampedSpoken.slice(0, 240),
    selectedSampleRate: sampleRate,
    selectedChannels: numChannels,
  });

  const dispatcher = getGodfreyFetchDispatcher();
  const elevenResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      Accept: "audio/pcm",
      "Content-Type": "application/json",
      "xi-api-key": settings.apiKey,
    },
    body: JSON.stringify({
      text: clampedSpoken,
      model_id: settings.modelId || ELEVENLABS_DEFAULT_MODEL_ID,
      output_format: outputFormat,
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarityBoost,
        use_speaker_boost: Boolean(settings.speakerBoost),
      },
    }),
    ...(dispatcher ? { dispatcher } : {}),
  });

  if (!elevenResponse.ok || !elevenResponse.body) {
    const details = await elevenResponse.text().catch(() => "");
    throw new Error(`ElevenLabs streaming request failed (${elevenResponse.status}): ${details || elevenResponse.statusText}`);
  }

  const elevenContentType = String(elevenResponse.headers.get("content-type") || "").toLowerCase();
  console.log("ElevenLabs stream response format", {
    requestedOutputFormat: outputFormat,
    contentType: elevenContentType || "unknown",
  });

  const isLikelyPcm =
    elevenContentType.includes("audio/pcm") ||
    elevenContentType.includes("application/octet-stream") ||
    elevenContentType.includes("audio/l16");

  if (!isLikelyPcm) {
    throw new Error(
      `ElevenLabs returned non-PCM stream content-type '${elevenContentType || "unknown"}'. Refusing fallback decode.`
    );
  }

  const frameBytes = pcmS16leAlignedFrameBytes(sampleRate, numChannels);
  const writeStepBytes = Math.max(frameBytes, Math.floor(STREAM_PCM_MAX_WRITE_BYTES / frameBytes) * frameBytes);

  let totalPcmBytes = 0;
  let loggedFirstBytes = false;
  let firstPcmTimingLogged = false;
  let carry = Buffer.alloc(0);

  const writeAlignedSlice = async (sub) => {
    if (!Buffer.isBuffer(sub) || sub.length === 0) {
      return;
    }
    if (!firstPcmTimingLogged) {
      firstPcmTimingLogged = true;
      timing?.log?.("first_pcm_write", { totalPcmBytesSoFar: totalPcmBytes, frameBytes, writeStepBytes });
    }
    if (!loggedFirstBytes) {
      loggedFirstBytes = true;
      console.log("First PCM bytes sent", {
        hex: firstBytesHex(sub, 24),
        count: Math.min(24, sub.length),
        frameBytes,
      });
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
      const sub = slice.subarray(offset, end);
      // eslint-disable-next-line no-await-in-loop
      await writeAlignedSlice(sub);
    }
  };

  const appendPcm = async (chunk) => {
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return;
    }
    carry = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    // eslint-disable-next-line no-await-in-loop
    await flushCarry();
  };

  const sourceNodeStream = Readable.fromWeb(elevenResponse.body, { highWaterMark: STREAM_PCM_MAX_WRITE_BYTES });

  for await (const chunk of sourceNodeStream) {
    const pcmChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    // eslint-disable-next-line no-await-in-loop
    await appendPcm(pcmChunk);
  }

  if (carry.length > 0) {
    const pad = (frameBytes - (carry.length % frameBytes)) % frameBytes;
    carry = pad === 0 ? carry : Buffer.concat([carry, Buffer.alloc(pad, 0)]);
    // eslint-disable-next-line no-await-in-loop
    await flushCarry();
  }

  res.end();
  timing?.log?.("last_pcm_write", { totalPcmBytes });
  console.log("Total PCM bytes sent", { totalPcmBytes });
}

async function streamMp3FileAsPcmToRes(res, { mp3Path, sampleRate, numChannels, timing, pcmBytesCounter }) {
  if (!mp3Path || !fs.existsSync(mp3Path)) {
    throw new Error("Admin bypass sample MP3 is missing.");
  }

  console.log("stream-pcm admin bypass sample", { mp3Path, sampleRate, numChannels });

  const frameBytes = pcmS16leAlignedFrameBytes(sampleRate, numChannels);
  const writeStepBytes = Math.max(frameBytes, Math.floor(STREAM_PCM_MAX_WRITE_BYTES / frameBytes) * frameBytes);
  let totalPcmBytes = 0;
  let loggedFirstBytes = false;
  let firstPcmTimingLogged = false;
  let carry = Buffer.alloc(0);

  const writeAlignedSlice = async (sub) => {
    if (!Buffer.isBuffer(sub) || sub.length === 0) {
      return;
    }
    if (!firstPcmTimingLogged) {
      firstPcmTimingLogged = true;
      timing?.log?.("first_pcm_write", { totalPcmBytesSoFar: totalPcmBytes, frameBytes, writeStepBytes, adminBypassSample: true });
    }
    if (!loggedFirstBytes) {
      loggedFirstBytes = true;
      console.log("First PCM bytes sent (admin bypass sample)", {
        hex: firstBytesHex(sub, 24),
        count: Math.min(24, sub.length),
        frameBytes,
      });
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
      const sub = slice.subarray(offset, end);
      // eslint-disable-next-line no-await-in-loop
      await writeAlignedSlice(sub);
    }
  };

  const appendPcm = async (chunk) => {
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return;
    }
    carry = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    // eslint-disable-next-line no-await-in-loop
    await flushCarry();
  };

  const ffmpegArgs = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    mp3Path,
    "-f",
    "s16le",
    "-acodec",
    "pcm_s16le",
    "-ac",
    String(numChannels),
    "-ar",
    String(sampleRate),
    "pipe:1",
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegArgs, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      child.stdout.pause();
      appendPcm(Buffer.from(chunk))
        .then(() => child.stdout.resume())
        .catch(reject);
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg PCM conversion failed (${code}): ${stderr.trim() || "unknown error"}`));
        return;
      }
      try {
        if (carry.length > 0) {
          const pad = (frameBytes - (carry.length % frameBytes)) % frameBytes;
          carry = pad === 0 ? carry : Buffer.concat([carry, Buffer.alloc(pad, 0)]);
          await flushCarry();
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  res.end();
  timing?.log?.("last_pcm_write", { totalPcmBytes, adminBypassSample: true });
  console.log("Total PCM bytes sent (admin bypass sample)", { totalPcmBytes });
}

async function transcribeAudioWithOpenAI({ audioBuffer, mimeType }) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured for speech-to-text.");
  }
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new Error("Audio upload is empty.");
  }
  const stream = Readable.from(audioBuffer);
  stream.path = `unreal-input.${mimeType?.includes("wav") ? "wav" : "webm"}`;
  const result = await openai.audio.transcriptions.create({
    file: stream,
    model: "gpt-4o-mini-transcribe",
  });
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  if (!text) {
    throw new Error("Speech-to-text returned no transcript.");
  }
  return text;
}

async function askGodfreyViaExistingPipeline({ messages, includeDocuments, logSessionId, maxWords }) {
  const dispatcher = getGodfreyFetchDispatcher();
  const body = {
    messages,
    includeDocuments,
    logSessionId,
    outputTarget: "browser",
  };
  if (maxWords !== undefined && maxWords !== null && Number.isFinite(Number(maxWords))) {
    body.maxWords = Number(maxWords);
  }
  const chatUrl = `http://127.0.0.1:${PORT}/api/chat`;
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Godfrey-Internal": "pipeline",
    },
    body: JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(
      `Chat pipeline returned non-JSON (${response.status}): ${String(rawText).slice(0, 300)}`
    );
  }
  if (!response.ok) {
    const err = new Error(payload?.error || payload?.details || "Chat pipeline failed.");
    err.payload = payload;
    throw err;
  }
  return payload;
}

function parseOutputTargetFromBody(body) {
  const raw = typeof body?.outputTarget === "string" ? body.outputTarget.trim().toLowerCase() : "";
  if (raw === "browser" || raw === "unreal") {
    return raw;
  }
  const env = String(process.env.GODFREY_DEFAULT_OUTPUT_TARGET || "").trim().toLowerCase();
  if (env === "browser" || env === "unreal") {
    return env;
  }
  return "browser";
}

function getFreshExhibitionUnrealTtsQueue() {
  if (!exhibitionUnrealTtsQueue) {
    return null;
  }
  if (Date.now() - exhibitionUnrealTtsQueue.createdAt > EXHIBITION_UNREAL_TTS_TTL_MS) {
    exhibitionUnrealTtsQueue = null;
    return null;
  }
  if (!exhibitionUnrealTtsQueue.requestId || typeof exhibitionUnrealTtsQueue.performanceText !== "string") {
    exhibitionUnrealTtsQueue = null;
    return null;
  }
  return exhibitionUnrealTtsQueue;
}

function consumeExhibitionUnrealTtsQueue(requestId) {
  const q = getFreshExhibitionUnrealTtsQueue();
  if (!q || q.requestId !== requestId) {
    return null;
  }
  const consumedEvents = Array.isArray(q.performanceEvents)
    ? q.performanceEvents
    : parsePerformanceEvents(q.performanceText);
  console.log("CONSUMED_PERFORMANCE_TEXT_FOR_TTS", q.performanceText);
  console.log("CONSUMED_PERFORMANCE_EVENTS_IF_AVAILABLE", JSON.stringify(consumedEvents));
  console.log("exhibition unreal TTS consumed", {
    requestId,
    adminTestBypass: Boolean(q.adminTestBypass),
  });
  const consumed = {
    performanceText: q.performanceText,
    adminTestBypass: Boolean(q.adminTestBypass),
  };
  exhibitionUnrealTtsQueue = null;
  return consumed;
}

function enrichChatResponseForExhibition(req, payload) {
  if (req.get("X-Godfrey-Internal") === "pipeline") {
    return payload;
  }
  const outputTarget = parseOutputTargetFromBody(req.body);
  const voiceInteraction = req.body?.voiceInteraction === true;
  let requestId = typeof req.body?.requestId === "string" && req.body.requestId.trim() ? req.body.requestId.trim() : "";
  if (outputTarget === "unreal" && !requestId) {
    requestId = crypto.randomUUID();
  }
  const base = {
    ...payload,
    outputTarget,
    voiceInteraction,
    requestId: requestId || null,
  };
  if (outputTarget !== "unreal") {
    return base;
  }
  const assistantText = typeof payload.response === "string" ? payload.response : "";
  if (!requestId || !assistantText) {
    return base;
  }
  const preparedText = prepareExhibitionPerformanceText(assistantText);
  console.log("EXHIBITION_QUEUE_PERFORMANCE_TEXT", preparedText);
  exhibitionUnrealTtsQueue = {
    requestId,
    performanceText: preparedText,
    performanceEvents: parsePerformanceEvents(preparedText),
    adminTestBypass: payload.adminTestBypass === true,
    createdAt: Date.now(),
  };
  console.log("exhibition unreal TTS queued for StreamGodfreySpeechToAudio", {
    requestId,
    performanceChars: preparedText.length,
    performanceEventCount: exhibitionUnrealTtsQueue.performanceEvents.length,
    adminTestBypass: exhibitionUnrealTtsQueue.adminTestBypass,
  });
  return {
    ...base,
    unrealTts: {
      queued: true,
      requestId,
      statusUrl: "/api/exhibition/unreal-tts-status",
      streamPcmHint:
        "POST /api/godfrey/speak/stream-pcm JSON with ttsOnly:true, requestId, sampleRate, numChannels (same as before).",
    },
  };
}

function isValidLogFilename(name) {
  return typeof name === "string" && LOG_FILENAME_RE.test(name) && name === path.basename(name);
}

function resolveSafeLogPath(filename) {
  if (!isValidLogFilename(filename)) {
    return null;
  }
  const full = path.join(LOGS_DIR, filename);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(LOGS_DIR))) {
    return null;
  }
  return resolved;
}

function createLogSession(clientIp) {
  const stamp = perthFilenameStamp().replace(/[:.]/g, "-");
  const id = crypto.randomBytes(8).toString("hex");
  const filename = `session-${stamp}-${id}.json`;
  const filePath = path.join(LOGS_DIR, filename);
  const payload = {
    createdAt: formatLogPerthTimestamp(),
    timeZone: LOG_TIMEZONE,
    clientIp: clientIp || null,
    exchanges: [],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filename;
}

function appendExchange(filename, userText, assistantText, clientIp) {
  const full = resolveSafeLogPath(filename);
  if (!full || !fs.existsSync(full)) {
    return false;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch {
    return false;
  }
  if (!Array.isArray(data.exchanges)) {
    data.exchanges = [];
  }
  data.exchanges.push({
    at: formatLogPerthTimestamp(),
    clientIp: clientIp || null,
    user: typeof userText === "string" ? userText : "",
    assistant: typeof assistantText === "string" ? assistantText : "",
  });
  fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf-8");
  return true;
}

function getLastUserText(sanitizedMessages) {
  for (let i = sanitizedMessages.length - 1; i >= 0; i -= 1) {
    if (sanitizedMessages[i].role === "user") {
      const text = sanitizedMessages[i].content?.[0]?.text;
      return typeof text === "string" ? text : "";
    }
  }
  return "";
}

function writeChatExchangeLog(req, sanitizedMessages, incomingLogId, responseText) {
  const userText = getLastUserText(sanitizedMessages);
  const ip = getClientIp(req);
  let file = typeof incomingLogId === "string" ? incomingLogId : null;
  if (!file || !resolveSafeLogPath(file) || !fs.existsSync(resolveSafeLogPath(file))) {
    file = createLogSession(ip);
  } else {
    const full = resolveSafeLogPath(file);
    try {
      const raw = JSON.parse(fs.readFileSync(full, "utf-8"));
      if (raw && (raw.clientIp == null || raw.clientIp === "") && ip) {
        raw.clientIp = ip;
        fs.writeFileSync(full, JSON.stringify(raw, null, 2), "utf-8");
      }
    } catch {
      /* leave file unchanged */
    }
  }
  appendExchange(file, userText, responseText, ip);
  return file;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

const providerAvailability = getAvailableProviders();
const configuredProvider = loadProviderConfig();
if (configuredProvider === "openai" && providerAvailability.openai) {
  currentProvider = "openai";
} else if (configuredProvider === "claude" && providerAvailability.claude) {
  currentProvider = "claude";
} else if (providerAvailability.claude) {
  currentProvider = "claude";
} else if (providerAvailability.openai) {
  currentProvider = "openai";
}

app.use(express.json({ limit: "1mb" }));
app.use("/api/unreal", (req, res, next) => {
  const allowOrigin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

app.use("/api/exhibition", (req, res, next) => {
  const allowOrigin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  return next();
});

app.get("/api/exhibition/unreal-tts-status", (req, res) => {
  const q = getFreshExhibitionUnrealTtsQueue();
  if (!q) {
    return res.json({
      ready: false,
      requestId: null,
      ttlMs: EXHIBITION_UNREAL_TTS_TTL_MS,
    });
  }
  const performanceEvents = Array.isArray(q.performanceEvents)
    ? q.performanceEvents
    : parsePerformanceEvents(q.performanceText);
  console.log("UNREAL_STATUS_PERFORMANCE_TEXT", q.performanceText);
  console.log("UNREAL_STATUS_PERFORMANCE_EVENTS", JSON.stringify(performanceEvents));
  return res.json({
    ready: true,
    requestId: q.requestId,
    assistantCharCount: q.performanceText.length,
    ageMs: Date.now() - q.createdAt,
    ttlMs: EXHIBITION_UNREAL_TTS_TTL_MS,
    performanceEvents,
  });
});
const sessionMiddleware = session({
  name: "godfrey.admin.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/godfrey/speak/stream-pcm") {
    return next();
  }
  return sessionMiddleware(req, res, next);
});
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".html" || ext === ".css" || ext === ".js") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  })
);

app.get("/admin", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: "ADMIN_PASSWORD is not set in the server environment." });
  }
  const password = req.body?.password;
  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }
  req.session.admin = true;
  return res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/admin/me", (req, res) => {
  return res.json({ admin: Boolean(req.session && req.session.admin) });
});

app.get("/api/splash-settings", (req, res) => {
  return res.json(splashSettings);
});

app.get("/api/test-bypass-active", (req, res) => {
  return res.json({ bypassAi: adminTestConfig.bypassAi === true });
});

app.post("/api/admin/splash-settings", requireAdmin, (req, res) => {
  const updated = sanitizeSplashSettings(req.body || {});
  splashSettings = updated;
  try {
    saveSplashSettings(updated);
  } catch (error) {
    console.error("Failed to save splash-config.json:", error);
    return res.status(500).json({ error: "Splash settings changed in memory but could not be saved to disk." });
  }
  return res.json(updated);
});

app.get("/api/admin/response-settings", requireAdmin, (req, res) => {
  return res.json(responseSettings);
});

app.post("/api/admin/response-settings", requireAdmin, (req, res) => {
  const updated = sanitizeResponseSettings(req.body || {});
  responseSettings = updated;
  try {
    saveResponseSettings(updated);
  } catch (error) {
    console.error("Failed to save response-config.json:", error);
    return res.status(500).json({ error: "Response settings changed in memory but could not be saved to disk." });
  }
  return res.json(updated);
});

app.get("/api/admin/test-bypass-settings", requireAdmin, (req, res) => {
  return res.json(buildAdminTestConfigResponse());
});

app.post("/api/admin/test-bypass-settings", requireAdmin, async (req, res) => {
  const updated = sanitizeAdminTestConfig({
    ...adminTestConfig,
    bypassAi: req.body?.bypassAi === true,
  });
  adminTestConfig = updated;
  try {
    saveAdminTestConfig(updated);
  } catch (error) {
    console.error("Failed to save admin-test-config.json:", error);
    return res.status(500).json({ error: "Test bypass settings changed in memory but could not be saved to disk." });
  }

  if (updated.bypassAi) {
    try {
      await ensureAdminBypassSampleAudio();
    } catch (error) {
      console.error("Failed to ensure admin bypass sample on save:", error);
      return res.status(500).json({
        error: error?.message || "Bypass enabled but sample audio could not be generated.",
        ...buildAdminTestConfigResponse(),
      });
    }
  }

  return res.json(buildAdminTestConfigResponse());
});

app.get("/api/admin/logs", requireAdmin, (req, res) => {
  try {
    const names = fs.readdirSync(LOGS_DIR).filter((f) => isValidLogFilename(f));
    const entries = names
      .map((name) => {
        const st = fs.statSync(path.join(LOGS_DIR, name));
        return { name, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return res.json({ logs: entries });
  } catch (error) {
    console.error("List logs error:", error);
    return res.status(500).json({ error: "Could not list session logs." });
  }
});

app.get("/api/admin/logs/:name", requireAdmin, (req, res) => {
  const full = resolveSafeLogPath(req.params.name);
  if (!full) {
    return res.status(400).json({ error: "Invalid log filename." });
  }
  try {
    if (!fs.existsSync(full)) {
      return res.status(404).json({ error: "Log not found." });
    }
    const raw = fs.readFileSync(full, "utf-8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(raw);
  } catch (error) {
    console.error("Read log error:", error);
    return res.status(500).json({ error: "Could not read log file." });
  }
});

app.get("/api/system-prompt", requireAdmin, (req, res) => {
  return res.json({ prompt: currentSystemPrompt });
});

app.get("/api/provider", (req, res) => {
  const available = getAvailableProviders();
  return res.json({
    provider: currentProvider,
    available,
  });
});

app.post("/api/provider", requireAdmin, (req, res) => {
  const { provider } = req.body || {};
  if (provider !== "claude" && provider !== "openai") {
    return res.status(400).json({ error: "provider must be claude or openai" });
  }

  if (provider === "claude" && !anthropic) {
    return res.status(400).json({ error: "ANTHROPIC_API_KEY is not configured." });
  }

  if (provider === "openai" && !openai) {
    return res.status(400).json({ error: "OPENAI_API_KEY is not configured." });
  }

  currentProvider = provider;
  try {
    saveProviderConfig(currentProvider);
  } catch (error) {
    console.error("Failed to save provider-config.json:", error);
    return res.status(500).json({ error: "Provider changed in memory but could not be saved to disk." });
  }

  return res.json({ provider: currentProvider });
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text, model, voice, speed, expressionPrompt, britishAccentBoost } = req.body || {};

    const { audioBuffer, mimeType } = await synthesizeOpenAI({
      openai,
      text,
      model,
      voice,
      speed,
      expressionPrompt,
      britishAccentBoost,
      defaultModel: OPENAI_TTS_DEFAULT_MODEL,
      defaultVoice: OPENAI_TTS_DEFAULT_VOICE,
      britishInstructions: OPENAI_TTS_BRITISH_BASE_INSTRUCTIONS,
    });

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "no-store");
    return res.send(audioBuffer);
  } catch (error) {
    if (isOpenAIConnectionError(error)) {
      return res.status(503).json({ error: "Connection to OpenAI TTS was interrupted. Please try again." });
    }

    console.error("OpenAI TTS error:", error);
    return res.status(500).json({
      error: "OpenAI speech generation failed.",
      details: error?.message || "Unknown error",
    });
  }
});

app.get("/api/admin/elevenlabs-settings", requireAdmin, (req, res) => {
  return res.json({
    ...elevenLabsSettings,
    apiKey: elevenLabsSettings.apiKey ? "********" : "",
    hasApiKey: Boolean(elevenLabsSettings.apiKey),
  });
});

app.post("/api/admin/elevenlabs-settings", requireAdmin, (req, res) => {
  const incoming = req.body || {};
  const nextSettings = sanitizeElevenLabsSettings({
    ...elevenLabsSettings,
    ...incoming,
  });

  if (incoming.apiKeyMasked === true && (!incoming.apiKey || String(incoming.apiKey).trim().length === 0)) {
    nextSettings.apiKey = elevenLabsSettings.apiKey;
  }

  elevenLabsSettings = nextSettings;
  try {
    saveElevenLabsSettings(nextSettings);
    return res.json({
      ...nextSettings,
      apiKey: nextSettings.apiKey ? "********" : "",
      hasApiKey: Boolean(nextSettings.apiKey),
    });
  } catch (error) {
    console.error("Failed to save elevenlabs-config.json:", error);
    return res.status(500).json({ error: "ElevenLabs settings changed in memory but could not be saved to disk." });
  }
});

app.get("/api/admin/performance-cues-selftest", requireAdmin, (req, res) => {
  const samplePerformanceText = ADMIN_PERFORMANCE_CUE_SELFTEST_TEXT;
  const performanceEvents = parsePerformanceEvents(samplePerformanceText);
  const strippedForTts = stripPerformanceCues(samplePerformanceText);
  return res.json({
    ok: true,
    samplePerformanceText,
    performanceEvents,
    strippedForTts,
    strippedHasNoCueMarkers: !/\[|\]|\*/.test(strippedForTts),
    parsedEventSummary: performanceEvents.map((e) => `${e.type}:${e.value}`).join(", "),
    checks: {
      hasThinkingPerformer: performanceEvents.some((e) => e.type === "performer" && e.value === "thinking"),
      hasSeriousPerformer: performanceEvents.some((e) => e.type === "performer" && e.value === "serious"),
      hasShortPause: performanceEvents.some((e) => e.type === "pause" && e.value === "short"),
      hasGazeDown: performanceEvents.some((e) => e.type === "gaze" && e.value === "down"),
      hasLeanForward: performanceEvents.some((e) => e.type === "posture" && e.value === "lean_forward"),
      spokenLinePreserved: /We hold to our course/.test(strippedForTts),
    },
  });
});

app.post("/api/tts/elevenlabs", async (req, res) => {
  try {
    const performanceText = typeof req.body?.text === "string" ? req.body.text : "";
    const spokenForEl = stripPerformanceCues(performanceText);
    if (!spokenForEl) {
      return res.status(400).json({
        error: "No speakable text after removing performance cues (or input was empty).",
      });
    }
    console.log("PERFORMANCE_TEXT_FOR_UNREAL", performanceText.trim());
    console.log("SPOKEN_TEXT_FOR_ELEVENLABS", spokenForEl);
    console.log("PERFORMANCE_EVENTS_PARSED", JSON.stringify(parsePerformanceEvents(performanceText.trim())));

    const rawOverrideSettings = req.body?.settings || {};
    const overrideSettings = sanitizeElevenLabsSettings({
      ...elevenLabsSettings,
      ...rawOverrideSettings,
    });

    // Preserve saved API key when frontend sends blank or masked placeholder.
    const incomingApiKey = typeof rawOverrideSettings.apiKey === "string" ? rawOverrideSettings.apiKey.trim() : "";
    if ((!incomingApiKey || incomingApiKey === "********") && elevenLabsSettings.apiKey) {
      overrideSettings.apiKey = elevenLabsSettings.apiKey;
    }

    const { audioBuffer, mimeType } = await synthesizeElevenLabs({
      text: spokenForEl.slice(0, 4096),
      settings: overrideSettings,
    });
    const suggestedDownloadFilename = `godfrey-response-${compactPerthFilenameStamp()}.mp3`;

    return res.json({
      responseText: performanceText.trim(),
      speechProvider: "elevenlabs",
      mimeType,
      suggestedDownloadFilename,
      audioBase64: audioBuffer.toString("base64"),
      metadata: {
        modelId: overrideSettings.modelId,
        voiceId: overrideSettings.voiceId,
        stability: overrideSettings.stability,
        similarityBoost: overrideSettings.similarityBoost,
        speakerBoost: Boolean(overrideSettings.speakerBoost),
      },
    });
  } catch (error) {
    console.error("ElevenLabs TTS error:", error);
    const status = Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    const normalizedStatus = status >= 400 && status < 600 ? status : 500;
    return res.status(normalizedStatus).json({
      error: "ElevenLabs speech generation failed.",
      details: error?.providerDetails || error?.message || "Unknown error",
      statusCode: normalizedStatus,
      speechProvider: "elevenlabs",
    });
  }
});

app.post("/api/godfrey/speak/stream-pcm", async (req, res) => {
  const t0 = process.hrtime.bigint();
  const msSinceStart = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const logTiming = (phase, extra = {}) => {
    console.log("stream-pcm timing", {
      phase,
      msSinceRequestReceived: Math.round(msSinceStart() * 1000) / 1000,
      isoTime: new Date().toISOString(),
      ...extra,
    });
  };

  let headersFlushed = false;
  let sampleRate;
  let numChannels;
  const pcmBytesCounter = { n: 0 };

  logTiming("request_received");

  try {
    const ttsOnly = req.body?.ttsOnly === true || req.body?.ttsOnly === "true";
    const ttsRequestId =
      typeof req.body?.requestId === "string" && req.body.requestId.trim() ? req.body.requestId.trim() : "";
    const sampleRateRaw = req.body?.sampleRate;
    const numChannelsRaw = req.body?.numChannels;
    const includeDocuments = req.body?.includeDocuments === true;
    let streamMaxWords = responseSettings.maxWords;
    if (req.body?.maxWords !== undefined && req.body?.maxWords !== null && String(req.body.maxWords).trim() !== "") {
      streamMaxWords = sanitizeResponseSettings({ maxWords: Number(req.body.maxWords) }).maxWords;
    } else if (
      process.env.GODFREY_STREAM_PCM_MAX_WORDS !== undefined &&
      String(process.env.GODFREY_STREAM_PCM_MAX_WORDS).trim() !== ""
    ) {
      streamMaxWords = sanitizeResponseSettings({ maxWords: Number(process.env.GODFREY_STREAM_PCM_MAX_WORDS) }).maxWords;
    }
    const logSessionId =
      typeof req.body?.logSessionId === "string" && req.body.logSessionId.trim()
        ? req.body.logSessionId.trim()
        : typeof req.body?.sessionId === "string" && req.body.sessionId.trim()
          ? req.body.sessionId.trim()
          : null;

    try {
      sampleRate = parseAndValidatePcmSampleRate(sampleRateRaw);
      numChannels = parseAndValidateNumChannels(numChannelsRaw);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError?.message || "Invalid audio parameters.",
      });
    }

    let promptText = "";
    let assistantReply = "";
    let adminTestBypassAudio = false;

    if (ttsOnly) {
      if (!ttsRequestId) {
        return res.status(400).json({
          success: false,
          error: "ttsOnly requires requestId (same value returned by POST /api/chat when outputTarget was unreal).",
        });
      }
      const queued = consumeExhibitionUnrealTtsQueue(ttsRequestId);
      if (!queued) {
        return res.status(409).json({
          success: false,
          error:
            "No matching queued assistant reply for this requestId. Send a browser /api/chat with outputTarget=unreal first, or the queue expired.",
        });
      }
      assistantReply = String(queued.performanceText || "").trim();
      adminTestBypassAudio = queued.adminTestBypass === true;
      if (!assistantReply) {
        return res.status(400).json({ success: false, error: "Queued assistant text was empty." });
      }
      logTiming("validated_tts_only", {
        sampleRate,
        numChannels,
        requestId: ttsRequestId,
        assistantChars: assistantReply.length,
        adminTestBypassAudio,
      });
      console.log("POST /api/godfrey/speak/stream-pcm ttsOnly (browser-queued assistant)", {
        requestId: ttsRequestId,
        length: assistantReply.length,
        preview: assistantReply.slice(0, 240),
        adminTestBypassAudio,
      });
    } else {
      promptText =
        (typeof req.body?.promptText === "string" && req.body.promptText.trim()) ||
        (typeof req.body?.PromptText === "string" && req.body.PromptText.trim()) ||
        (typeof req.body?.text === "string" && req.body.text.trim()) ||
        "";

      if (!promptText) {
        return res.status(400).json({
          success: false,
          error: "Missing user message: send promptText, PromptText, or text (Unreal prompt).",
        });
      }

      logTiming("validated", { sampleRate, numChannels, promptLength: promptText.length });

      console.log("POST /api/godfrey/speak/stream-pcm incoming prompt", {
        length: promptText.length,
        preview: promptText.slice(0, 240),
      });
    }

    res.status(200);
    res.setHeader("Content-Type", `audio/L16;rate=${sampleRate};channels=${numChannels}`);
    res.setHeader("Cache-Control", "no-store, no-transform, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Audio-Format", "pcm_s16le");
    res.setHeader("X-Audio-Endian", "little");
    res.setHeader("X-Audio-Sample-Rate", String(sampleRate));
    res.setHeader("X-Audio-Channels", String(numChannels));

    if (res.socket && typeof res.socket.setNoDelay === "function") {
      res.socket.setNoDelay(true);
    }

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    headersFlushed = true;
    logTiming("headers_flushed", {
      includeDocuments,
      streamMaxWords,
      ttsOnly,
      leadSilenceMsDefault: "set GODFREY_STREAM_PCM_LEAD_SILENCE_MS=0 to omit leading silence",
    });

    const leadMs = parseStreamPcmLeadSilenceMs();
    if (leadMs > 0) {
      const frameBytesLead = pcmS16leAlignedFrameBytes(sampleRate, numChannels);
      const rawBytes = Math.floor((sampleRate * numChannels * 2 * leadMs) / 1000);
      let bytesTotal = Math.floor(rawBytes / frameBytesLead) * frameBytesLead;
      if (bytesTotal === 0) {
        bytesTotal = frameBytesLead;
      }
      const writeStep = Math.max(frameBytesLead, Math.floor(STREAM_PCM_MAX_WRITE_BYTES / frameBytesLead) * frameBytesLead);
      const silence = Buffer.alloc(bytesTotal, 0);
      for (let offset = 0; offset < silence.length; offset += writeStep) {
        const end = Math.min(offset + writeStep, silence.length);
        const sub = silence.subarray(offset, end);
        pcmBytesCounter.n += sub.length;
        if (!res.write(sub)) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
      logTiming("lead_silence_written", { leadMs, bytes: bytesTotal, frameBytes: frameBytesLead });
    }

    if (!ttsOnly) {
      logTiming("llm_started", { includeDocuments, maxWords: streamMaxWords });
      const chatPayload = await askGodfreyViaExistingPipeline({
        messages: [{ role: "user", content: promptText }],
        includeDocuments,
        logSessionId,
        maxWords: streamMaxWords,
      });
      assistantReply = typeof chatPayload?.response === "string" ? chatPayload.response.trim() : "";
      adminTestBypassAudio = chatPayload?.adminTestBypass === true;
      if (!assistantReply) {
        throw new Error("Godfrey Brain returned an empty assistant reply.");
      }
      logTiming("llm_done", { assistantChars: assistantReply.length, adminTestBypassAudio });

      console.log("POST /api/godfrey/speak/stream-pcm generated assistant reply", {
        length: assistantReply.length,
        preview: assistantReply.slice(0, 240),
      });
    } else {
      logTiming("llm_skipped_tts_only", { requestId: ttsRequestId });
    }

    console.log("POST /api/godfrey/speak/stream-pcm performance text (cues preserved; ElevenLabs uses stripped spoken text)", {
      length: assistantReply.length,
      preview: assistantReply.slice(0, 240),
    });

    logTiming("tts_started", { adminTestBypassAudio });
    if (adminTestBypassAudio) {
      const mp3Path = await ensureAdminBypassSampleAudio();
      await streamMp3FileAsPcmToRes(res, {
        mp3Path,
        sampleRate,
        numChannels,
        timing: { log: logTiming },
        pcmBytesCounter,
      });
    } else {
      await streamElevenLabsPcmToRes(res, {
        text: assistantReply,
        settings: elevenLabsSettings,
        sampleRate,
        numChannels,
        timing: { log: logTiming },
        pcmBytesCounter,
      });
    }
  } catch (error) {
    console.error("POST /api/godfrey/speak/stream-pcm error", {
      error: error?.message || String(error),
      headersFlushed,
      pcmBytesOut: pcmBytesCounter.n,
      sampleRate: sampleRate ?? null,
      numChannels: numChannels ?? null,
    });
    if (headersFlushed) {
      if (!res.writableEnded) {
        try {
          if (
            pcmBytesCounter.n === 0 &&
            typeof sampleRate === "number" &&
            typeof numChannels === "number" &&
            numChannels === 1
          ) {
            const padMs = 100;
            const frameBytesPad = pcmS16leAlignedFrameBytes(sampleRate, numChannels);
            const rawPad = Math.min(96000, Math.floor((sampleRate * numChannels * 2 * padMs) / 1000));
            const padBytes = Math.floor(rawPad / frameBytesPad) * frameBytesPad;
            if (padBytes > 0) {
              res.write(Buffer.alloc(padBytes, 0));
              pcmBytesCounter.n += padBytes;
              logTiming("error_pad_silence_written", { padBytes, padMs, frameBytes: frameBytesPad });
            }
          }
          res.end();
        } catch {
          /* response may already be closing */
        }
      }
      return;
    }
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to stream PCM audio.",
      });
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
});

app.post("/api/unreal/ask", express.raw({ type: ["audio/*", "application/octet-stream"], limit: "15mb" }), async (req, res) => {
  let responseText = "";
  let sessionId = null;
  try {
    const isRawAudio = Buffer.isBuffer(req.body);
    const incoming = isRawAudio ? {} : req.body || {};
    sessionId = typeof incoming.sessionId === "string" ? incoming.sessionId : null;
    const includeDocuments = incoming.includeDocuments !== false;
    let questionText = typeof incoming.question === "string" ? incoming.question.trim() : "";
    let uploadedAudioBuffer = null;

    if (!questionText && isRawAudio) {
      uploadedAudioBuffer = req.body;
    } else if (!questionText && typeof incoming.audioBase64 === "string" && incoming.audioBase64.trim().length > 0) {
      uploadedAudioBuffer = Buffer.from(incoming.audioBase64, "base64");
    }

    if (!questionText && uploadedAudioBuffer) {
      questionText = await transcribeAudioWithOpenAI({
        audioBuffer: uploadedAudioBuffer,
        mimeType: incoming.audioMimeType || req.get("content-type") || "audio/webm",
      });
    }

    if (!questionText) {
      return res.status(400).json({
        success: false,
        error: "Provide either question text, raw audio body (Content-Type: audio/*), or audioBase64 in JSON.",
      });
    }

    const chatPayload = await askGodfreyViaExistingPipeline({
      messages: [{ role: "user", content: questionText }],
      includeDocuments,
      logSessionId: sessionId,
    });
    responseText = typeof chatPayload.response === "string" ? chatPayload.response.trim() : "";
    sessionId = chatPayload.logSessionId || sessionId;
    const useAdminBypassAudio = chatPayload.adminTestBypass === true;

    if (useAdminBypassAudio) {
      await ensureAdminBypassSampleAudio();
      responseText = ADMIN_BYPASS_DISPLAY_TEXT;
    }

    const spokenForEl = useAdminBypassAudio
      ? ADMIN_BYPASS_SAMPLE_SPOKEN_TEXT
      : stripPerformanceCues(responseText);
    if (!spokenForEl) {
      return res.status(400).json({
        success: false,
        error: "Assistant reply contained only performance cues; nothing left for speech synthesis.",
      });
    }
    console.log("PERFORMANCE_TEXT_FOR_UNREAL", responseText);
    console.log("SPOKEN_TEXT_FOR_ELEVENLABS", spokenForEl);
    console.log("PERFORMANCE_EVENTS_PARSED", JSON.stringify(parsePerformanceEvents(responseText)));

    let mp3Path;
    let mp3SizeBytes;
    if (useAdminBypassAudio) {
      mp3Path = ADMIN_BYPASS_SAMPLE_MP3_PATH;
      mp3SizeBytes = fs.statSync(mp3Path).size;
    } else {
      const mp3Result = await synthesizeElevenLabs({
        text: spokenForEl.slice(0, 4096),
        settings: elevenLabsSettings,
        outputFormat: "mp3_44100_128",
        accept: "audio/mpeg",
      });
      const generatedMp3Filename = buildGeneratedAudioFilename("mp3");
      mp3Path = path.join(GENERATED_AUDIO_DIR, generatedMp3Filename);
      fs.writeFileSync(mp3Path, mp3Result.audioBuffer);
      mp3SizeBytes = fs.statSync(mp3Path).size;
    }

    const mp3Filename = path.basename(mp3Path);
    const wavFilename = mp3Filename.replace(/\.mp3$/i, ".wav");
    const wavPath = path.join(path.dirname(mp3Path), wavFilename);
    let wavSizeBytes = 0;
    let mp3DurationSeconds = null;
    let wavDurationSeconds = null;

    try {
      await convertMp3ToPcmWav({ mp3Path, wavPath });
      wavSizeBytes = fs.statSync(wavPath).size;
      [mp3DurationSeconds, wavDurationSeconds] = await Promise.all([
        getMediaDurationSeconds(mp3Path),
        getMediaDurationSeconds(wavPath),
      ]);

      const durationDelta = Math.abs(mp3DurationSeconds - wavDurationSeconds);
      if (durationDelta > 0.25) {
        throw new Error(
          `WAV duration mismatch: mp3=${mp3DurationSeconds.toFixed(3)}s wav=${wavDurationSeconds.toFixed(3)}s delta=${durationDelta.toFixed(3)}s`
        );
      }
    } catch (wavError) {
      console.error("WAV conversion failed for Unreal endpoint.", {
        error: wavError?.message || String(wavError),
        ffmpegStderr: wavError?.stderr || null,
      });
      if (fs.existsSync(wavPath)) {
        try {
          fs.unlinkSync(wavPath);
        } catch (unlinkError) {
          console.error("Failed to remove invalid WAV file:", unlinkError);
        }
      }
      throw wavError;
    }

    console.log("Unreal audio generation stats:", {
      mp3Path,
      wavPath,
      mp3SizeBytes,
      wavSizeBytes,
      mp3DurationSeconds,
      wavDurationSeconds,
    });

    const audioPathname = mp3Path.startsWith(GENERATED_AUDIO_DIR)
      ? `/audio/generated/${mp3Filename}`
      : `/audio/${mp3Filename}`;
    const wavPathname = wavPath.startsWith(GENERATED_AUDIO_DIR)
      ? `/audio/generated/${wavFilename}`
      : `/audio/${wavFilename}`;
    const suggestedFilename = useAdminBypassAudio
      ? "godfrey-admin-bypass-sample.mp3"
      : `godfrey-response-${compactPerthFilenameStamp()}.mp3`;

    return res.json({
      success: true,
      sessionId: sessionId || null,
      text: responseText,
      speechProvider: "elevenlabs",
      audioUrl: createAbsoluteUrl(req, audioPathname),
      wavUrl: createAbsoluteUrl(req, wavPathname),
      mimeType: "audio/mpeg",
      durationSeconds: Number(wavDurationSeconds.toFixed(3)),
      suggestedFilename,
      emotion: null,
      intensity: null,
      gesture: null,
    });
  } catch (error) {
    console.error("Unreal ask endpoint error:", error);
    return res.status(500).json({
      success: false,
      sessionId: sessionId || null,
      text: responseText || null,
      speechProvider: "elevenlabs",
      error: error?.message || "Unreal ask request failed.",
      emotion: null,
      intensity: null,
      gesture: null,
    });
  }
});

app.post("/api/conversation-pdf", (req, res) => {
  try {
    const incoming = req.body?.messages;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    const messages = incoming
      .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant"))
      .map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content.replace(/\r/g, "").trim() : "",
      }))
      .filter((msg) => msg.content.length > 0)
      .slice(-300);

    if (messages.length === 0) {
      return res.status(400).json({ error: "No conversation messages available for export." });
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", (error) => {
      console.error("PDF generation error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF." });
      }
    });
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `godfrey-conversation-${perthFilenameStamp()}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdfBuffer);
    });

    const avatarSize = 56;
    const avatarX = doc.page.margins.left;
    const avatarY = doc.y;
    const avatarRadius = avatarSize / 2;
    const titleX = avatarX + avatarSize + 14;
    const contentWidth = doc.page.width - doc.page.margins.right - titleX;

    if (fs.existsSync(CAPTAIN_PORTRAIT_PATH)) {
      try {
        doc.save();
        doc.circle(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius).clip();
        doc.image(CAPTAIN_PORTRAIT_PATH, avatarX, avatarY, { width: avatarSize, height: avatarSize });
        doc.restore();
        doc
          .circle(avatarX + avatarRadius, avatarY + avatarRadius, avatarRadius)
          .lineWidth(1)
          .strokeColor("#4F6878")
          .stroke();
      } catch (error) {
        console.warn("Unable to include captain portrait in PDF:", error.message);
      }
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111").text("Captain John Godfrey Conversation", titleX, avatarY + 8, {
      width: contentWidth,
    });
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text(`Exported: ${formatLogPerthTimestamp()}`, titleX, avatarY + 32, {
      width: contentWidth,
    });
    doc.y = Math.max(doc.y, avatarY + avatarSize + 8);
    doc.moveDown(0.8);

    messages.forEach((msg, index) => {
      const speaker = msg.role === "assistant" ? "Captain John Godfrey" : "User";
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(`${speaker}:`);
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(11).fillColor("#222222").text(msg.content, { lineGap: 2 });
      doc.moveDown(0.6);

      if (index < messages.length - 1) {
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.4).stroke("#CCCCCC");
        doc.moveDown(0.6);
      }
    });

    doc.end();
  } catch (error) {
    console.error("Conversation PDF route failed:", error);
    return res.status(500).json({ error: "Failed to generate PDF." });
  }
});

app.post("/api/system-prompt", requireAdmin, (req, res) => {
  const { mode, text } = req.body || {};

  if (mode !== "replace" && mode !== "append") {
    return res.status(400).json({ error: "mode must be replace or append" });
  }

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "text must be a non-empty string" });
  }

  if (mode === "replace") {
    currentSystemPrompt = text.trim();
  } else {
    currentSystemPrompt = `${currentSystemPrompt}\n\n${text.trim()}`;
  }

  try {
    saveSystemPrompt(currentSystemPrompt);
    return res.json({ prompt: currentSystemPrompt });
  } catch (error) {
    console.error("Failed to save system prompt:", error);
    return res.status(500).json({ error: "Failed to save system prompt" });
  }
});

app.post("/api/chat", async (req, res) => {
  const voiceRequestId = req.get("X-Godfrey-Voice-Request-Id");
  if (voiceRequestId) {
    console.log("godfrey-voice-trace", { phase: "chat_received", requestId: voiceRequestId });
  }
  const selectedProvider = currentProvider;
  const rawBodyMaxWords = req.body?.maxWords;
  const maxWordsPerReply =
    rawBodyMaxWords !== undefined && rawBodyMaxWords !== null && String(rawBodyMaxWords).trim() !== ""
      ? sanitizeResponseSettings({ maxWords: Number(rawBodyMaxWords) }).maxWords
      : responseSettings.maxWords;
  const maxTokensForReply = estimateTokenBudgetFromWordLimit(maxWordsPerReply);

  try {
    const { messages, includeDocuments, logSessionId: incomingLogId } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    if (selectedProvider !== "claude" && selectedProvider !== "openai") {
      return res.status(400).json({ error: "provider must be claude or openai" });
    }

    const sanitizedMessages = messages
      .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant"))
      .map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? [{ type: "text", text: msg.content }]
            : [{ type: "text", text: "" }],
      }))
      .slice(-MAX_HISTORY_MESSAGES);

    if (await respondWithAdminBypassIfEnabled(req, res, sanitizedMessages, incomingLogId)) {
      return;
    }

    if (selectedProvider === "openai") {
      if (!openai) {
        return res.status(400).json({ error: "OPENAI_API_KEY is not configured." });
      }

      const inputMessages = sanitizedMessages.map((msg) => ({
        role: msg.role,
        content: msg.content[0].text,
      }));

      const requestParams = {
        model: OPENAI_MODEL,
        max_output_tokens: maxTokensForReply,
        instructions: `${currentSystemPrompt}\n\n${SOURCE_PRIORITY_ADDENDUM}\n\n${OPENAI_STYLE_ADDENDUM}`,
        temperature: 1,
        input: inputMessages,
      };

      if (includeDocuments !== false && openaiConfig.vectorStoreId) {
        requestParams.tools = [
          {
            type: "file_search",
            vector_store_ids: [openaiConfig.vectorStoreId],
          },
        ];
      }

      const openaiResponse = await callOpenAIWithRetry(requestParams);
      const responseText =
        typeof openaiResponse.output_text === "string" && openaiResponse.output_text.trim().length > 0
          ? openaiResponse.output_text.trim()
          : "*He pauses, unwilling to offer a reply.*";
      if (parseOutputTargetFromBody(req.body) === "unreal") {
        console.log("CHAT_RESPONSE_TEXT_RAW", responseText);
      }
      const limitedOpenAi = limitResponseToWordCount(responseText, maxWordsPerReply);

      const isTruncated = openaiResponse.status === "incomplete";
      let activeLogFile = null;
      try {
        activeLogFile = writeChatExchangeLog(req, sanitizedMessages, incomingLogId, limitedOpenAi.text);
      } catch (logErr) {
        console.error("Session log write failed:", logErr);
      }
      return res.json(
        enrichChatResponseForExhibition(req, {
          response: limitedOpenAi.text,
          truncated: isTruncated || limitedOpenAi.wasLimited,
          logSessionId: activeLogFile,
        })
      );
    }

    if (!anthropic) {
      return res.status(400).json({ error: "ANTHROPIC_API_KEY is not configured." });
    }

    const requestMessages = [...sanitizedMessages];

    if (includeDocuments !== false && uploadedDocs.length > 0) {
      const documentContextBlocks = [
        {
          type: "text",
          text:
            "Background documents for this conversation are attached below. Use them as reference context alongside the system instructions.",
        },
      ];

      for (const doc of uploadedDocs) {
        documentContextBlocks.push({
          type: "document",
          source: {
            type: "file",
            file_id: doc.fileId,
          },
        });
      }

      requestMessages.unshift({
        role: "user",
        content: documentContextBlocks,
      });
    }

    const requestParams = {
      model: "claude-sonnet-4-6",
      max_tokens: maxTokensForReply,
      betas: ["files-api-2025-04-14", "pdfs-2024-09-25"],
      system: `${currentSystemPrompt}\n\n${SOURCE_PRIORITY_ADDENDUM}`,
      messages: requestMessages,
    };

    let claudeResponse;
    try {
      claudeResponse = await callClaudeWithRetry(requestParams);
    } catch (apiError) {
      const hasDocFormatIssue =
        uploadedDocs.length > 0 &&
        typeof apiError?.message === "string" &&
        apiError.message.includes("Unsupported document file format");

      if (!hasDocFormatIssue) {
        throw apiError;
      }

      console.warn(
        "Uploaded document format issue detected; retrying request without attached documents. Re-run node upload-docs.js to regenerate valid file IDs."
      );

      claudeResponse = await callClaudeWithRetry({
        ...requestParams,
        messages: sanitizedMessages,
      });
    }

    const responseText = claudeResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (parseOutputTargetFromBody(req.body) === "unreal") {
      console.log("CHAT_RESPONSE_TEXT_RAW", responseText);
    }
    const limitedClaude = limitResponseToWordCount(responseText, maxWordsPerReply);

    const isTruncated = claudeResponse.stop_reason === "max_tokens";
    let activeLogFile = null;
    try {
      activeLogFile = writeChatExchangeLog(req, sanitizedMessages, incomingLogId, limitedClaude.text);
    } catch (logErr) {
      console.error("Session log write failed:", logErr);
    }
    return res.json(
      enrichChatResponseForExhibition(req, {
        response: limitedClaude.text,
        truncated: isTruncated || limitedClaude.wasLimited,
        logSessionId: activeLogFile,
      })
    );
  } catch (error) {
    if (isOpenAIConnectionError(error)) {
      return res.status(503).json({
        error: "Connection to OpenAI was interrupted. Please try again.",
      });
    }

    if (isConnectionError(error)) {
      return res.status(503).json({
        error: "Connection to Claude was interrupted. Please try again.",
      });
    }

    if (error?.code === "CLAUDE_TIMEOUT" || error?.code === "OPENAI_TIMEOUT") {
      return res.status(504).json({
        error: "Captain Godfrey took too long to reply from the selected provider. Please try again.",
      });
    }

    if (selectedProvider === "openai") {
      const openaiKind = classifyOpenAIHttpError(error);
      if (openaiKind === "billing") {
        return res.status(402).json({
          error:
            "OpenAI could not run this request — this usually means billing, credits, or quota need attention. Check your OpenAI account billing and usage limits, then try again. You can switch back to Claude in the app if Anthropic is available.",
          errorCode: "openai_billing",
        });
      }
      if (openaiKind === "auth") {
        return res.status(401).json({
          error:
            "OpenAI rejected your API key. Check OPENAI_API_KEY in .env and regenerate the key in the OpenAI dashboard if needed.",
          errorCode: "openai_auth",
        });
      }
      if (openaiKind === "rate_limit") {
        return res.status(429).json({
          error: "OpenAI rate limit reached. Wait a short while and try again.",
          errorCode: "openai_rate_limit",
        });
      }
      console.error("OpenAI API error:", error);
      return res.status(500).json({
        error: "OpenAI could not complete this request. Check the server log for details.",
        details: error?.message || "Unknown error",
        errorCode: "openai_unknown",
      });
    }

    const anthropicKind = classifyAnthropicHttpError(error);
    if (anthropicKind === "billing") {
      return res.status(402).json({
        error:
          "Anthropic could not run this request — this usually means credits are exhausted or billing needs attention. Open your Anthropic Console billing page, add credits or update payment, then try again. You can also switch to OpenAI in this app if it is configured.",
        errorCode: "anthropic_billing",
      });
    }
    if (anthropicKind === "auth") {
      return res.status(401).json({
        error:
          "Anthropic rejected your API key. Check ANTHROPIC_API_KEY in .env and confirm the key is active in the Anthropic console.",
        errorCode: "anthropic_auth",
      });
    }
    if (anthropicKind === "rate_limit") {
      return res.status(429).json({
        error: "Anthropic rate limit reached. Wait a minute and try again, or shorten messages.",
        errorCode: "anthropic_rate_limit",
      });
    }

    console.error("Claude API error:", error);
    return res.status(500).json({
      error: "Claude could not complete this request. Check the server log for details.",
      details: error?.message || "Unknown error",
      errorCode: "anthropic_unknown",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Default provider: ${currentProvider}`);

  if (uploadedDocs.length === 0) {
    console.log("No uploaded document IDs loaded. Add PDFs to docs/ then run node upload-docs.js");
  } else {
    console.log(`Loaded ${uploadedDocs.length} uploaded documents from file-ids.json`);
  }

  if (openaiConfig.vectorStoreId) {
    console.log(`Loaded OpenAI vector store: ${openaiConfig.vectorStoreId}`);
  } else {
    console.log("No OpenAI vector store configured. Run node upload-openai-docs.js for OpenAI context.");
  }
});
