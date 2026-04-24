const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const PDFDocument = require("pdfkit");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
/** Session JSON logs; set GODFREY_LOGS_DIR on servers so history survives git pull / deploy in the repo tree. */
const LOGS_DIR = process.env.GODFREY_LOGS_DIR
  ? path.resolve(process.env.GODFREY_LOGS_DIR)
  : path.join(__dirname, "logs");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "dev-insecure-change-admin-session-secret";

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
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
- Include brief stage directions in italics occasionally (no more than 1-2 per reply).`;
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
const CAPTAIN_PORTRAIT_PATH = path.join(__dirname, "public", "images", "Captain Godfrey.png");
const DEFAULT_SPLASH_SETTINGS = { t1Ms: 1000, t2Ms: 1000 };

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
app.use(
  session({
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
  })
);
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

    if (!openai) {
      return res.status(400).json({ error: "OPENAI_API_KEY is not configured." });
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text must be a non-empty string" });
    }

    const inputText = text.trim().slice(0, 4096);
    const selectedModel = typeof model === "string" && model.length > 0 ? model : OPENAI_TTS_DEFAULT_MODEL;
    const selectedVoice = typeof voice === "string" && voice.length > 0 ? voice : OPENAI_TTS_DEFAULT_VOICE;
    const parsedSpeed = Number.isFinite(Number(speed)) ? Number(speed) : 1;
    const clampedSpeed = Math.max(0.25, Math.min(4, parsedSpeed));
    const stylePrompt = typeof expressionPrompt === "string" ? expressionPrompt.trim() : "";
    const accentBoostEnabled = britishAccentBoost !== false;

    let ttsModel = selectedModel;
    if (accentBoostEnabled && !ttsModel.startsWith("gpt-4o-mini-tts")) {
      ttsModel = OPENAI_TTS_DEFAULT_MODEL;
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
        instructionParts.push(OPENAI_TTS_BRITISH_BASE_INSTRUCTIONS);
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

    res.setHeader("Content-Type", "audio/mpeg");
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
  const selectedProvider = currentProvider;

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
        max_output_tokens: MAX_RESPONSE_TOKENS,
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

      const isTruncated = openaiResponse.status === "incomplete";
      let activeLogFile = null;
      try {
        activeLogFile = writeChatExchangeLog(req, sanitizedMessages, incomingLogId, responseText);
      } catch (logErr) {
        console.error("Session log write failed:", logErr);
      }
      return res.json({ response: responseText, truncated: isTruncated, logSessionId: activeLogFile });
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
      max_tokens: MAX_RESPONSE_TOKENS,
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

    const isTruncated = claudeResponse.stop_reason === "max_tokens";
    let activeLogFile = null;
    try {
      activeLogFile = writeChatExchangeLog(req, sanitizedMessages, incomingLogId, responseText);
    } catch (logErr) {
      console.error("Session log write failed:", logErr);
    }
    return res.json({ response: responseText, truncated: isTruncated, logSessionId: activeLogFile });
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
