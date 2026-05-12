const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const resetButton = document.getElementById("resetButton");
const refreshContextButton = document.getElementById("refreshContextButton");
const downloadConversationButton = document.getElementById("downloadConversationButton");
const downloadStatus = document.getElementById("downloadStatus");
const typingIndicator = document.getElementById("typingIndicator");
const providerSelect = document.getElementById("providerSelect");
const saveProviderButton = document.getElementById("saveProviderButton");
const providerStatus = document.getElementById("providerStatus");
const systemPromptInput = document.getElementById("systemPromptInput");
const refreshPromptButton = document.getElementById("refreshPromptButton");
const appendPromptButton = document.getElementById("appendPromptButton");
const replacePromptButton = document.getElementById("replacePromptButton");
const adminStatus = document.getElementById("adminStatus");
const sendButton = chatForm.querySelector('button[type="submit"]');
const speechModeSelect = document.getElementById("speechModeSelect");
const speechExpressionInput = document.getElementById("speechExpressionInput");
const britishAccentBoostInput = document.getElementById("britishAccentBoostInput");
const simpleSpeechSettings = document.getElementById("simpleSpeechSettings");
const simpleVoiceSelect = document.getElementById("simpleVoiceSelect");
const simpleRateInput = document.getElementById("simpleRateInput");
const simplePitchInput = document.getElementById("simplePitchInput");
const openaiSpeechSettings = document.getElementById("openaiSpeechSettings");
const openaiVoiceSelect = document.getElementById("openaiVoiceSelect");
const openaiTtsModelSelect = document.getElementById("openaiTtsModelSelect");
const openaiSpeechSpeedInput = document.getElementById("openaiSpeechSpeedInput");
const elevenLabsSpeechSettings = document.getElementById("elevenLabsSpeechSettings");
const elevenLabsApiKeyInput = document.getElementById("elevenLabsApiKeyInput");
const elevenLabsVoiceIdInput = document.getElementById("elevenLabsVoiceIdInput");
const elevenLabsModelIdInput = document.getElementById("elevenLabsModelIdInput");
const elevenLabsStabilityInput = document.getElementById("elevenLabsStabilityInput");
const elevenLabsSimilarityBoostInput = document.getElementById("elevenLabsSimilarityBoostInput");
const elevenLabsSpeakerBoostInput = document.getElementById("elevenLabsSpeakerBoostInput");
const saveSpeechSettingsButton = document.getElementById("saveSpeechSettingsButton");
const applyBritishPresetButton = document.getElementById("applyBritishPresetButton");
const stopSpeechButton = document.getElementById("stopSpeechButton");
const speechStatus = document.getElementById("speechStatus");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const adminLoginButton = document.getElementById("adminLoginButton");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const adminAuthStatus = document.getElementById("adminAuthStatus");
const adminLoginBlock = document.getElementById("adminLoginBlock");
const adminSignedInBlock = document.getElementById("adminSignedInBlock");
const refreshLogsButton = document.getElementById("refreshLogsButton");
const logFileSelect = document.getElementById("logFileSelect");
const logViewerContent = document.getElementById("logViewerContent");
const captainPortraitButton = document.getElementById("captainPortraitButton");
const portraitModal = document.getElementById("portraitModal");
const portraitModalClose = document.getElementById("portraitModalClose");
const splashScreen = document.getElementById("splashScreen");
const splashT1Input = document.getElementById("splashT1Input");
const splashT2Input = document.getElementById("splashT2Input");
const saveSplashSettingsAdminButton = document.getElementById("saveSplashSettingsAdminButton");
const splashSettingsStatus = document.getElementById("splashSettingsStatus");
const maxReplyWordsInput = document.getElementById("maxReplyWordsInput");
const saveResponseSettingsAdminButton = document.getElementById("saveResponseSettingsAdminButton");
const responseSettingsStatus = document.getElementById("responseSettingsStatus");
const continueReplyRow = document.getElementById("continueReplyRow");
const continueReplyButton = document.getElementById("continueReplyButton");

/** Large push-to-talk control (Web Speech API). */
const godfreyPttButton = document.getElementById("godfreyPttButton");
const godfreyPttLabel = document.getElementById("godfreyPttLabel");
const godfreyPttInterimLine = document.getElementById("godfreyPttInterimLine");

const fetchOpts = { credentials: "include" };

let conversation = [];
let isAdmin = false;
let logSessionId = null;
let isSending = false;
let hasTrackedConversationStart = false;
let hasTrackedConversationEnd = false;
let questionsAskedThisSession = 0;
const CHAT_TIMEOUT_MS = 20000;
const DEFAULT_SPLASH_SETTINGS = { t1Ms: 1000, t2Ms: 1000 };
let splashSettings = { ...DEFAULT_SPLASH_SETTINGS };
let responseSettings = { maxWords: 120 };
/** Milliseconds of quiet after the Captain's last reply before a single in-character nudge (display only). */
const IDLE_NUDGE_MS = 120000;
let idleNudgeTimer = null;
/** True after we've shown an idle nudge for this user turn; reset when the user sends another message. */
let nudgedSinceLastUserTurn = false;

const IDLE_NUDGE_LINES = [
  "*He taps the table lightly.* What would you have me speak to next?",
  "*He narrows his eyes, curious.* Are you yourself a mariner, or come to this tale by some other road?",
  "*He exhales.* Do you think it fair that I have been made a scapegoat for what befell the Georgette?",
  "*He leans forward slightly.* Is it the inquiry you wish to pursue, or the wreck itself?",
  "*He studies your silence.* Have I said aught that sits ill with you?",
  "*He folds his arms.* Shall I speak plain of the engineers, or hold my tongue for the moment?",
];

let includeDocumentsNextTurn = true;
let currentProvider = "claude";
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
/** Single recognition instance for push-to-talk (recreated after each session where needed). */
let speechRecognizer = null;
let simpleSpeechVoices = [];
let activeAudio = null;
let activeAudioUrl = null;

// ---------------------------------------------------------------------------
// Push-to-talk (Web Speech API — browser only; no server STT)
// ---------------------------------------------------------------------------

let godfreyPttListening = false;
let godfreyPttUserAborted = false;
let godfreyPttSubmitInFlight = false;
let godfreyPttReceivedFinalThisStart = false;
let godfreyLastInterimText = "";
let godfreyLastFinalText = "";
let godfreyLastFinalAt = 0;
let godfreyNoSpeechRetryCount = 0;

/** Mic button label + listening / processing ring states. */
function setGodfreyPttChrome({ listening = false, processing = false } = {}) {
  if (!godfreyPttButton) {
    return;
  }
  godfreyPttButton.classList.toggle("is-listening", listening);
  godfreyPttButton.classList.toggle("is-processing", processing);
  godfreyPttButton.setAttribute("aria-pressed", listening ? "true" : "false");
  if (godfreyPttLabel) {
    if (listening) {
      godfreyPttLabel.textContent = "Listening… tap again to cancel";
    } else if (processing) {
      godfreyPttLabel.textContent = "Sending…";
    } else {
      godfreyPttLabel.textContent = "Tap to speak";
    }
  }
}

function resetGodfreyPttVisualIdle() {
  godfreyPttListening = false;
  godfreyPttSubmitInFlight = false;
  godfreyPttReceivedFinalThisStart = false;
  godfreyNoSpeechRetryCount = 0;
  if (godfreyPttButton) {
    godfreyPttButton.classList.remove("is-listening", "is-processing");
    godfreyPttButton.setAttribute("aria-pressed", "false");
    godfreyPttButton.disabled = isSending;
  }
  if (godfreyPttInterimLine) {
    godfreyPttInterimLine.textContent = "";
  }
  godfreyLastInterimText = "";
  setGodfreyPttChrome({});
}

function stopGodfreySpeechRecognizer() {
  if (!speechRecognizer) {
    return;
  }
  try {
    speechRecognizer.stop();
  } catch {
    try {
      speechRecognizer.abort();
    } catch {
      /* ignore */
    }
  }
}

function destroyGodfreySpeechRecognizer() {
  stopGodfreySpeechRecognizer();
  speechRecognizer = null;
}

function trackConversationStartedIfNeeded() {
  if (hasTrackedConversationStart) return;
  trackEvent("Conversation Started");
  hasTrackedConversationStart = true;
  hasTrackedConversationEnd = false;
}

function trackConversationEndedIfNeeded() {
  if (!hasTrackedConversationStart || hasTrackedConversationEnd) return;
  trackEvent("Conversation Ended", {
    questions_asked: questionsAskedThisSession,
  });
  hasTrackedConversationEnd = true;
}

function trackError(errorType) {
  trackEvent("Error", { type: errorType || "unknown" });
}

const SPEECH_SETTINGS_KEY = "godfrey-speech-settings-v1";
const BRITISH_EXPRESSION_PRESET =
  "Use clear British English pronunciation (Received Pronunciation leaning), non-rhotic R, formal Victorian diction, measured naval cadence, restrained bitterness, and dignified emotional control.";
const defaultSpeechSettings = {
  mode: "none",
  expressionPrompt: BRITISH_EXPRESSION_PRESET,
  britishAccentBoost: true,
  simple: {
    voiceName: "",
    rate: 0.95,
    pitch: 0.9,
  },
  openai: {
    voice: "marin",
    model: "gpt-4o-mini-tts",
    speed: 1,
  },
  elevenlabs: {
    apiKey: "",
    voiceId: "",
    modelId: "eleven_multilingual_v2",
    stability: 0.5,
    similarityBoost: 0.75,
    speakerBoost: true,
  },
};
let speechSettings = JSON.parse(JSON.stringify(defaultSpeechSettings));
let hasStoredElevenLabsApiKey = false;

function appendMessage(role, content) {
  const isCaptain = role === "assistant";
  const row = document.createElement("div");
  row.className = `message-row ${isCaptain ? "captain" : "visitor"}`;

  const avatar = document.createElement("div");
  avatar.className = `message-avatar ${isCaptain ? "captain" : "visitor"}`;
  if (isCaptain) {
    const avatarImage = document.createElement("img");
    avatarImage.className = "message-avatar-image";
    avatarImage.src = "images/Captain Godfrey.png";
    avatarImage.alt = "Captain John Godfrey";
    avatarImage.loading = "lazy";
    avatar.appendChild(avatarImage);
  } else {
    avatar.textContent = "U";
    avatar.setAttribute("aria-hidden", "true");
  }

  const message = document.createElement("div");
  message.className = `message ${isCaptain ? "captain" : "visitor"}`;
  message.textContent = content;

  if (isCaptain) {
    row.appendChild(avatar);
    row.appendChild(message);
  } else {
    row.appendChild(message);
    row.appendChild(avatar);
  }

  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

function focusLatestReplyRow(row) {
  if (!row) return;
  row.setAttribute("tabindex", "-1");
  const top = Math.max(0, row.offsetTop - 8);
  requestAnimationFrame(() => {
    chatWindow.scrollTo({ top, behavior: "smooth" });
    // Keep virtual keyboard dismissed by moving focus away from text input.
    row.focus({ preventScroll: true });
  });
}

function openPortraitModal() {
  if (!portraitModal) return;
  portraitModal.classList.remove("hidden-block");
  document.body.classList.add("portrait-modal-open");
}

function closePortraitModal() {
  if (!portraitModal) return;
  portraitModal.classList.add("hidden-block");
  document.body.classList.remove("portrait-modal-open");
}

function runSplashSequence() {
  if (!splashScreen) return;
  splashScreen.style.setProperty("--splash-fade-ms", `${splashSettings.t2Ms}ms`);
  setTimeout(() => {
    splashScreen.classList.add("fade-out");
    setTimeout(() => {
      splashScreen.classList.add("hidden-block");
    }, splashSettings.t2Ms);
  }, splashSettings.t1Ms);
}

function clearIdleNudgeTimer() {
  if (idleNudgeTimer) {
    clearTimeout(idleNudgeTimer);
    idleNudgeTimer = null;
  }
}

function scheduleIdleNudge() {
  clearIdleNudgeTimer();
  const last = conversation[conversation.length - 1];
  if (!last || last.role !== "assistant" || nudgedSinceLastUserTurn) {
    return;
  }
  idleNudgeTimer = setTimeout(() => {
    idleNudgeTimer = null;
    if (document.hidden || isSending || nudgedSinceLastUserTurn) {
      return;
    }
    const lastAgain = conversation[conversation.length - 1];
    if (!lastAgain || lastAgain.role !== "assistant") {
      return;
    }
    const line = IDLE_NUDGE_LINES[Math.floor(Math.random() * IDLE_NUDGE_LINES.length)];
    appendMessage("assistant", line);
    void speakAssistantReply(line);
    nudgedSinceLastUserTurn = true;
  }, IDLE_NUDGE_MS);
}

function bumpIdleNudgeAfterUserActivity() {
  clearIdleNudgeTimer();
  if (nudgedSinceLastUserTurn) {
    return;
  }
  const last = conversation[conversation.length - 1];
  if (last && last.role === "assistant") {
    scheduleIdleNudge();
  }
}

function setTyping(isTyping) {
  typingIndicator.classList.toggle("hidden", !isTyping);
}

function setProviderStatus(message, isError = false) {
  providerStatus.textContent = message;
  providerStatus.style.color = isError ? "#e3a0a0" : "";
}

function setDownloadStatus(message, isError = false) {
  if (!downloadStatus) return;
  downloadStatus.textContent = message;
  downloadStatus.style.color = isError ? "#e3a0a0" : "";
}

function setContinueReplyVisible(visible) {
  if (!continueReplyRow) return;
  continueReplyRow.classList.toggle("hidden-block", !visible);
}

function setAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.style.color = isError ? "#e3a0a0" : "";
}

function setAdminAuthStatus(message, isError = false) {
  if (!adminAuthStatus) return;
  adminAuthStatus.textContent = message;
  adminAuthStatus.style.color = isError ? "#e3a0a0" : "";
}

function setSplashSettingsStatus(message, isError = false) {
  if (!splashSettingsStatus) return;
  splashSettingsStatus.textContent = message;
  splashSettingsStatus.style.color = isError ? "#e3a0a0" : "";
}

function setResponseSettingsStatus(message, isError = false) {
  if (!responseSettingsStatus) return;
  responseSettingsStatus.textContent = message;
  responseSettingsStatus.style.color = isError ? "#e3a0a0" : "";
}

function parseMaxReplyWords(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(10, Math.min(1000, Math.round(parsed)));
}

function parseSplashTiming(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10000, Math.round(parsed)));
}

function applySplashSettingsToInputs() {
  if (!splashT1Input || !splashT2Input) return;
  splashT1Input.value = String(splashSettings.t1Ms);
  splashT2Input.value = String(splashSettings.t2Ms);
}

async function loadSplashSettings() {
  try {
    const response = await fetch("/api/splash-settings", fetchOpts);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load splash settings.");
    }
    splashSettings = {
      t1Ms: parseSplashTiming(data.t1Ms, DEFAULT_SPLASH_SETTINGS.t1Ms),
      t2Ms: parseSplashTiming(data.t2Ms, DEFAULT_SPLASH_SETTINGS.t2Ms),
    };
  } catch {
    splashSettings = { ...DEFAULT_SPLASH_SETTINGS };
  }
  applySplashSettingsToInputs();
}

function applyResponseSettingsToInputs() {
  if (!maxReplyWordsInput) return;
  maxReplyWordsInput.value = String(responseSettings.maxWords);
}

async function loadResponseSettings() {
  if (!isAdmin) return;
  try {
    const response = await fetch("/api/admin/response-settings", fetchOpts);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load response settings.");
    }
    responseSettings = {
      maxWords: parseMaxReplyWords(data.maxWords, responseSettings.maxWords),
    };
    applyResponseSettingsToInputs();
  } catch (error) {
    setResponseSettingsStatus(error.message || "Unable to load response settings.", true);
  }
}

async function saveResponseSettings() {
  if (!isAdmin) return;
  const next = {
    maxWords: parseMaxReplyWords(maxReplyWordsInput?.value, responseSettings.maxWords),
  };
  try {
    const response = await fetch("/api/admin/response-settings", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(next),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save response settings.");
    }
    responseSettings = {
      maxWords: parseMaxReplyWords(data.maxWords, next.maxWords),
    };
    applyResponseSettingsToInputs();
    setResponseSettingsStatus("Response limit saved.");
  } catch (error) {
    setResponseSettingsStatus(error.message || "Failed to save response settings.", true);
  }
}

async function saveSplashSettings() {
  if (!isAdmin) return;
  const next = {
    t1Ms: parseSplashTiming(splashT1Input?.value, splashSettings.t1Ms),
    t2Ms: parseSplashTiming(splashT2Input?.value, splashSettings.t2Ms),
  };

  try {
    const response = await fetch("/api/admin/splash-settings", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(next),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save splash settings.");
    }
    splashSettings = {
      t1Ms: parseSplashTiming(data.t1Ms, next.t1Ms),
      t2Ms: parseSplashTiming(data.t2Ms, next.t2Ms),
    };
    applySplashSettingsToInputs();
    setSplashSettingsStatus("Splash timing saved.");
  } catch (error) {
    setSplashSettingsStatus(error.message || "Failed to save splash settings.", true);
  }
}

function applyAdminGating() {
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.classList.toggle("admin-only-hidden", !isAdmin);
  });
  if (adminLoginBlock) {
    adminLoginBlock.classList.toggle("hidden-block", isAdmin);
  }
  if (adminSignedInBlock) {
    adminSignedInBlock.classList.toggle("hidden-block", !isAdmin);
  }
}

async function checkAdminSession() {
  try {
    const response = await fetch("/api/admin/me", fetchOpts);
    const data = await response.json();
    isAdmin = Boolean(data.admin);
  } catch {
    isAdmin = false;
  }
  applyAdminGating();
  if (isAdmin) {
    loadSystemPrompt();
    refreshLogFileList();
    loadSplashSettings();
    loadElevenLabsSettings();
    loadResponseSettings();
  }
}

async function adminLogin() {
  if (!adminPasswordInput) return;
  const password = adminPasswordInput.value;
  if (!password) {
    setAdminAuthStatus("Enter the admin password.", true);
    return;
  }
  try {
    const response = await fetch("/api/admin/login", {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Sign-in failed.");
    }
    adminPasswordInput.value = "";
    setAdminAuthStatus("Signed in.");
    isAdmin = true;
    applyAdminGating();
    loadSystemPrompt();
    refreshLogFileList();
    loadSplashSettings();
    loadElevenLabsSettings();
    loadResponseSettings();
  } catch (error) {
    setAdminAuthStatus(error.message || "Sign-in failed.", true);
  }
}

async function adminLogout() {
  try {
    await fetch("/api/admin/logout", { ...fetchOpts, method: "POST" });
  } catch {
    /* ignore */
  }
  isAdmin = false;
  logViewerContent.textContent = "Select a log file to view JSON contents.";
  logFileSelect.innerHTML = '<option value="">— Select a log file —</option>';
  applyAdminGating();
  setAdminAuthStatus("Signed out.");
}

async function refreshLogFileList() {
  if (!isAdmin) return;
  try {
    const response = await fetch("/api/admin/logs", fetchOpts);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not list logs.");
    }
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const selected = logFileSelect.value;
    logFileSelect.innerHTML = '<option value="">— Select a log file —</option>';
    for (const entry of logs) {
      const opt = document.createElement("option");
      opt.value = entry.name;
      opt.textContent = entry.name;
      logFileSelect.appendChild(opt);
    }
    if (selected && [...logFileSelect.options].some((o) => o.value === selected)) {
      logFileSelect.value = selected;
    }
  } catch (error) {
    logViewerContent.textContent = error.message || "Failed to load log list.";
  }
}

async function loadSelectedLogFile() {
  const name = logFileSelect.value;
  if (!name) {
    logViewerContent.textContent = "Select a log file to view JSON contents.";
    return;
  }
  try {
    const response = await fetch(`/api/admin/logs/${encodeURIComponent(name)}`, fetchOpts);
    const text = await response.text();
    if (!response.ok) {
      let err = text;
      try {
        err = JSON.parse(text).error || err;
      } catch {
        /* use raw */
      }
      throw new Error(err);
    }
    const parsed = JSON.parse(text);
    logViewerContent.textContent = JSON.stringify(parsed, null, 2);
  } catch (error) {
    logViewerContent.textContent = error.message || "Could not read log.";
  }
}

function setSpeechStatus(message, isError = false) {
  speechStatus.textContent = message;
  speechStatus.style.color = isError ? "#e3a0a0" : "";
}

function readSpeechSettingsFromInputs() {
  return {
    mode: speechModeSelect.value,
    expressionPrompt: speechExpressionInput.value.trim(),
    britishAccentBoost: Boolean(britishAccentBoostInput.checked),
    simple: {
      voiceName: simpleVoiceSelect.value || "",
      rate: Number(simpleRateInput.value) || 1,
      pitch: Number(simplePitchInput.value) || 1,
    },
    openai: {
      voice: openaiVoiceSelect.value || "marin",
      model: openaiTtsModelSelect.value || "gpt-4o-mini-tts",
      speed: Number(openaiSpeechSpeedInput.value) || 1,
    },
    elevenlabs: {
      apiKey: elevenLabsApiKeyInput.value.trim(),
      voiceId: elevenLabsVoiceIdInput.value.trim(),
      modelId: elevenLabsModelIdInput.value.trim() || "eleven_multilingual_v2",
      stability: Number(elevenLabsStabilityInput.value),
      similarityBoost: Number(elevenLabsSimilarityBoostInput.value),
      speakerBoost: Boolean(elevenLabsSpeakerBoostInput.checked),
    },
  };
}

function applySpeechSettingsToInputs() {
  speechModeSelect.value = speechSettings.mode;
  speechExpressionInput.value = speechSettings.expressionPrompt;
  britishAccentBoostInput.checked = Boolean(speechSettings.britishAccentBoost);
  simpleRateInput.value = String(speechSettings.simple.rate);
  simplePitchInput.value = String(speechSettings.simple.pitch);
  openaiVoiceSelect.value = speechSettings.openai.voice;
  openaiTtsModelSelect.value = speechSettings.openai.model;
  openaiSpeechSpeedInput.value = String(speechSettings.openai.speed);
  elevenLabsApiKeyInput.value = speechSettings.elevenlabs.apiKey;
  elevenLabsVoiceIdInput.value = speechSettings.elevenlabs.voiceId;
  elevenLabsModelIdInput.value = speechSettings.elevenlabs.modelId;
  elevenLabsStabilityInput.value = String(speechSettings.elevenlabs.stability);
  elevenLabsSimilarityBoostInput.value = String(speechSettings.elevenlabs.similarityBoost);
  elevenLabsSpeakerBoostInput.checked = Boolean(speechSettings.elevenlabs.speakerBoost);

  if (speechSettings.simple.voiceName && simpleSpeechVoices.some((v) => v.name === speechSettings.simple.voiceName)) {
    simpleVoiceSelect.value = speechSettings.simple.voiceName;
  }
}

function updateSpeechPanelVisibility() {
  const mode = speechModeSelect.value;
  simpleSpeechSettings.style.display = mode === "simple" ? "flex" : "none";
  openaiSpeechSettings.style.display = mode === "openai" ? "flex" : "none";
  elevenLabsSpeechSettings.style.display = mode === "elevenlabs" ? "flex" : "none";
}

function loadSpeechSettings() {
  try {
    const raw = localStorage.getItem(SPEECH_SETTINGS_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    speechSettings = {
      ...defaultSpeechSettings,
      ...parsed,
      simple: {
        ...defaultSpeechSettings.simple,
        ...(parsed.simple || {}),
      },
      openai: {
        ...defaultSpeechSettings.openai,
        ...(parsed.openai || {}),
      },
      elevenlabs: {
        ...defaultSpeechSettings.elevenlabs,
        ...(parsed.elevenlabs || {}),
      },
    };
  } catch (error) {
    console.warn("Unable to read stored speech settings, using defaults.", error);
  }
}

function saveSpeechSettings() {
  speechSettings = readSpeechSettingsFromInputs();
  updateSpeechPanelVisibility();
  saveElevenLabsSettings();
}

async function loadElevenLabsSettings() {
  if (!isAdmin) return;
  try {
    const response = await fetch("/api/admin/elevenlabs-settings", fetchOpts);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load ElevenLabs settings.");
    }
    speechSettings.elevenlabs = {
      ...speechSettings.elevenlabs,
      voiceId: data.voiceId || "",
      modelId: data.modelId || speechSettings.elevenlabs.modelId,
      stability: Number.isFinite(Number(data.stability)) ? Number(data.stability) : speechSettings.elevenlabs.stability,
      similarityBoost: Number.isFinite(Number(data.similarityBoost))
        ? Number(data.similarityBoost)
        : speechSettings.elevenlabs.similarityBoost,
      speakerBoost: data.speakerBoost !== false,
      apiKey: data.hasApiKey ? "********" : "",
    };
    hasStoredElevenLabsApiKey = Boolean(data.hasApiKey);
    localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(speechSettings));
    applySpeechSettingsToInputs();
  } catch (error) {
    setSpeechStatus(error.message || "Unable to load ElevenLabs settings.", true);
  }
}

async function saveElevenLabsSettings() {
  if (!isAdmin) {
    localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(speechSettings));
    setSpeechStatus("Speech settings saved.");
    return;
  }

  const latest = readSpeechSettingsFromInputs();
  const maskedInput = latest.elevenlabs.apiKey === "********";

  try {
    const response = await fetch("/api/admin/elevenlabs-settings", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...latest.elevenlabs,
        apiKey: maskedInput && hasStoredElevenLabsApiKey ? "" : latest.elevenlabs.apiKey,
        apiKeyMasked: maskedInput,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save ElevenLabs settings.");
    }

    speechSettings = {
      ...latest,
      elevenlabs: {
        ...latest.elevenlabs,
        apiKey: data.hasApiKey ? "********" : "",
        voiceId: data.voiceId || latest.elevenlabs.voiceId,
        modelId: data.modelId || latest.elevenlabs.modelId,
        stability: Number.isFinite(Number(data.stability)) ? Number(data.stability) : latest.elevenlabs.stability,
        similarityBoost: Number.isFinite(Number(data.similarityBoost))
          ? Number(data.similarityBoost)
          : latest.elevenlabs.similarityBoost,
        speakerBoost: data.speakerBoost !== false,
      },
    };
    hasStoredElevenLabsApiKey = Boolean(data.hasApiKey);
    localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(speechSettings));
    applySpeechSettingsToInputs();
    setSpeechStatus("Speech settings saved.");
  } catch (error) {
    setSpeechStatus(error.message || "Unable to save ElevenLabs settings.", true);
  }
}

function stopSpeechPlayback() {
  window.speechSynthesis.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

function sanitizeTextForSpeech(text) {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\[Reply clipped by response limit[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPreferredBritishVoice() {
  return (
    simpleSpeechVoices.find((voice) => voice.lang.toLowerCase().startsWith("en-gb")) ||
    simpleSpeechVoices.find((voice) => voice.lang.toLowerCase().startsWith("en-ie")) ||
    simpleSpeechVoices.find((voice) => voice.lang.toLowerCase().startsWith("en-au")) ||
    null
  );
}

function populateSimpleVoices() {
  simpleSpeechVoices = window.speechSynthesis.getVoices();
  if (simpleSpeechVoices.length === 0) return;

  const previous = simpleVoiceSelect.value;
  simpleVoiceSelect.innerHTML = "";

  for (const voice of simpleSpeechVoices) {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    simpleVoiceSelect.appendChild(option);
  }

  if (speechSettings.simple.voiceName && simpleSpeechVoices.some((v) => v.name === speechSettings.simple.voiceName)) {
    simpleVoiceSelect.value = speechSettings.simple.voiceName;
  } else if (previous && simpleSpeechVoices.some((v) => v.name === previous)) {
    simpleVoiceSelect.value = previous;
  } else if (speechSettings.britishAccentBoost) {
    const britishVoice = findPreferredBritishVoice();
    if (britishVoice) {
      simpleVoiceSelect.value = britishVoice.name;
    }
  }
}

function speakWithSimpleSpeech(text) {
  if (!("speechSynthesis" in window)) {
    setSpeechStatus("Simple speech is not supported in this browser.", true);
    return;
  }

  stopSpeechPlayback();
  const utterance = new SpeechSynthesisUtterance(text);
  let selectedVoice = simpleSpeechVoices.find((voice) => voice.name === speechSettings.simple.voiceName);
  if (!selectedVoice && speechSettings.britishAccentBoost) {
    selectedVoice = findPreferredBritishVoice();
  }
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.rate = Math.max(0.6, Math.min(1.4, speechSettings.simple.rate));
  utterance.pitch = Math.max(0.6, Math.min(1.6, speechSettings.simple.pitch));
  utterance.onstart = () => setSpeechStatus("Speaking with browser voice...");
  utterance.onend = () => setSpeechStatus("Speech complete.");
  utterance.onerror = () => setSpeechStatus("Simple speech failed.", true);
  window.speechSynthesis.speak(utterance);
}

async function speakWithOpenAI(text) {
  try {
    stopSpeechPlayback();
    setSpeechStatus("Generating OpenAI speech...");

    const response = await fetch("/api/tts", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model: speechSettings.openai.model,
        voice: speechSettings.openai.voice,
        speed: speechSettings.openai.speed,
        expressionPrompt: speechSettings.expressionPrompt,
        britishAccentBoost: speechSettings.britishAccentBoost,
      }),
    });

    if (!response.ok) {
      const maybeJson = await response.json().catch(() => ({}));
      throw new Error(maybeJson.error || "OpenAI speech request failed.");
    }

    const audioBlob = await response.blob();
    activeAudioUrl = URL.createObjectURL(audioBlob);
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.onended = () => {
      setSpeechStatus("Speech complete.");
      if (activeAudioUrl) {
        URL.revokeObjectURL(activeAudioUrl);
        activeAudioUrl = null;
      }
      activeAudio = null;
    };
    activeAudio.onerror = () => {
      setSpeechStatus("Audio playback failed.", true);
    };
    await activeAudio.play();
    setSpeechStatus("Playing OpenAI speech...");
  } catch (error) {
    console.error(error);
    setSpeechStatus(error.message || "OpenAI speech failed.", true);
  }
}

function appendElevenLabsDownloadButton(row, blob, filename) {
  if (!row || !(blob instanceof Blob)) return;
  const existing = row.querySelector(".elevenlabs-download");
  if (existing) {
    existing.remove();
  }
  const wrapper = document.createElement("div");
  wrapper.className = "elevenlabs-download";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "download-button";
  button.textContent = "Download audio";
  button.addEventListener("click", () => {
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename || "godfrey-response.mp3";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  });
  wrapper.appendChild(button);
  row.appendChild(wrapper);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

async function speakWithElevenLabs(text, replyRow) {
  try {
    stopSpeechPlayback();
    setSpeechStatus("Generating ElevenLabs speech...");
    const response = await fetch("/api/tts/elevenlabs", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        settings: {
          apiKey:
            speechSettings.elevenlabs.apiKey &&
            speechSettings.elevenlabs.apiKey !== "********"
              ? speechSettings.elevenlabs.apiKey
              : "",
          voiceId: speechSettings.elevenlabs.voiceId,
          modelId: speechSettings.elevenlabs.modelId,
          stability: speechSettings.elevenlabs.stability,
          similarityBoost: speechSettings.elevenlabs.similarityBoost,
          speakerBoost: speechSettings.elevenlabs.speakerBoost,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const detail = [data.error, data.details].filter(Boolean).join(" ");
      throw new Error(detail || "ElevenLabs speech request failed.");
    }
    if (!data.audioBase64) {
      throw new Error("No ElevenLabs audio was returned.");
    }

    const audioBlob = base64ToBlob(data.audioBase64, data.mimeType);
    appendElevenLabsDownloadButton(replyRow, audioBlob, data.suggestedDownloadFilename);
    activeAudioUrl = URL.createObjectURL(audioBlob);
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.onended = () => {
      setSpeechStatus("Speech complete.");
      if (activeAudioUrl) {
        URL.revokeObjectURL(activeAudioUrl);
        activeAudioUrl = null;
      }
      activeAudio = null;
    };
    activeAudio.onerror = () => {
      setSpeechStatus("Audio playback failed.", true);
    };
    await activeAudio.play();
    setSpeechStatus("Playing ElevenLabs speech...");
  } catch (error) {
    console.error(error);
    setSpeechStatus(error.message || "ElevenLabs speech failed. Showing text response only.", true);
  }
}

async function speakAssistantReply(text, replyRow = null) {
  if (!isAdmin) return;
  const cleaned = sanitizeTextForSpeech(text);
  if (!cleaned) return;

  speechSettings = readSpeechSettingsFromInputs();
  if (speechSettings.mode === "none") return;
  if (speechSettings.mode === "simple") {
    speakWithSimpleSpeech(cleaned);
    return;
  }
  if (speechSettings.mode === "openai") {
    await speakWithOpenAI(cleaned);
    return;
  }
  if (speechSettings.mode === "elevenlabs") {
    await speakWithElevenLabs(cleaned, replyRow);
  }
}

function applyStrongBritishPreset() {
  speechModeSelect.value = "openai";
  openaiTtsModelSelect.value = "gpt-4o-mini-tts";
  openaiVoiceSelect.value = "marin";
  openaiSpeechSpeedInput.value = "0.95";
  speechExpressionInput.value = BRITISH_EXPRESSION_PRESET;
  britishAccentBoostInput.checked = true;
  simpleRateInput.value = "0.95";
  simplePitchInput.value = "0.9";

  const britishVoice = findPreferredBritishVoice();
  if (britishVoice) {
    simpleVoiceSelect.value = britishVoice.name;
  }

  updateSpeechPanelVisibility();
  saveSpeechSettings();
}

async function loadProvider() {
  try {
    const response = await fetch("/api/provider", fetchOpts);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load provider");
    }

    currentProvider = data.provider || "claude";
    providerSelect.value = currentProvider;
    setProviderStatus(`Using ${currentProvider === "openai" ? "OpenAI" : "Claude"}.`);
  } catch (error) {
    setProviderStatus(error.message || "Unable to load provider.", true);
  }
}

async function saveProvider() {
  const selected = providerSelect.value;
  try {
    const response = await fetch("/api/provider", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: selected }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to update provider");
    }

    currentProvider = data.provider;
    includeDocumentsNextTurn = true;
    setProviderStatus(`Using ${currentProvider === "openai" ? "OpenAI" : "Claude"}.`);
  } catch (error) {
    providerSelect.value = currentProvider;
    setProviderStatus(error.message || "Unable to update provider.", true);
  }
}

async function loadSystemPrompt() {
  try {
    const response = await fetch("/api/system-prompt", fetchOpts);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load system prompt");
    }

    systemPromptInput.value = data.prompt || "";
    setAdminStatus("Loaded current system prompt.");
  } catch (error) {
    setAdminStatus(error.message || "Unable to load system prompt.", true);
  }
}

async function updateSystemPrompt(mode) {
  const text = systemPromptInput.value.trim();
  if (!text) {
    setAdminStatus("Prompt text cannot be empty.", true);
    return;
  }

  try {
    const response = await fetch("/api/system-prompt", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode, text }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to update system prompt");
    }

    systemPromptInput.value = data.prompt || "";
    setAdminStatus(mode === "replace" ? "System prompt replaced." : "Text appended to system prompt.");
  } catch (error) {
    setAdminStatus(error.message || "Unable to update system prompt.", true);
  }
}

async function sendMessage(content, options = {}) {
  const { voiceInteraction = false } = options;
  const userText = String(content ?? "").trim();
  if (!userText) {
    if (voiceInteraction) {
      godfreyPttSubmitInFlight = false;
      resetGodfreyPttVisualIdle();
      destroyGodfreySpeechRecognizer();
    }
    return;
  }
  if (isSending) {
    if (voiceInteraction) {
      godfreyPttSubmitInFlight = false;
      resetGodfreyPttVisualIdle();
      destroyGodfreySpeechRecognizer();
    }
    return;
  }
  setContinueReplyVisible(false);
  clearIdleNudgeTimer();
  nudgedSinceLastUserTurn = false;
  isSending = true;
  let latestAssistantRow = null;
  trackConversationStartedIfNeeded();
  questionsAskedThisSession += 1;
  trackEvent("Question Asked", { question_length: userText.length });
  conversation.push({ role: "user", content: userText });
  appendMessage("user", userText);

  setTyping(true);
  sendButton.disabled = true;
  messageInput.disabled = true;
  if (godfreyPttButton) {
    godfreyPttButton.disabled = true;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  const shouldIncludeDocuments = includeDocumentsNextTurn;
  includeDocumentsNextTurn = false;

  try {
    const response = await fetch("/api/chat", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: conversation,
        includeDocuments: shouldIncludeDocuments,
        logSessionId,
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      const err = new Error(data.error || data.details || "Request failed");
      if (data.errorCode) {
        err.errorCode = data.errorCode;
      }
      throw err;
    }

    let captainReply = data.response || "*He pauses, unwilling to offer a reply.*";
    if (data.truncated) {
      captainReply +=
        "\n\n[Reply clipped by response limit — tap Continue, or type continue, for the next part.]";
      setContinueReplyVisible(true);
    }
    conversation.push({ role: "assistant", content: captainReply });
    latestAssistantRow = appendMessage("assistant", captainReply);
    trackEvent("Response Received", { response_length: captainReply.length });
    if (typeof data.logSessionId === "string" && data.logSessionId) {
      logSessionId = data.logSessionId;
    }

    await speakAssistantReply(captainReply, latestAssistantRow);
    scheduleIdleNudge();
  } catch (error) {
    let errorType = "unknown";
    if (error.name === "AbortError") {
      errorType = "timeout_abort";
      latestAssistantRow = appendMessage(
        "assistant",
        "*He glances toward the horizon.* The line has gone dead; pray ask again in a moment."
      );
    } else if (typeof error.message === "string" && error.message.includes("took too long")) {
      errorType = "timeout";
      latestAssistantRow = appendMessage(
        "assistant",
        "*He checks his watch and exhales.* The exchange has taken too long to complete; ask again and I shall answer directly."
      );
    } else if (typeof error.message === "string" && error.message.includes("Connection to Claude")) {
      errorType = "claude_connection";
      latestAssistantRow = appendMessage(
        "assistant",
        "*He drums his fingers upon the rail.* There is interference upon the line to shore; put your question again directly."
      );
    } else if (typeof error.message === "string" && error.message.includes("Connection to OpenAI")) {
      errorType = "openai_connection";
      latestAssistantRow = appendMessage(
        "assistant",
        "*He frowns at the telegraph relay.* The OpenAI line has failed for the moment; ask me again directly."
      );
    } else if (
      error.errorCode === "anthropic_billing" ||
      error.errorCode === "openai_billing" ||
      error.errorCode === "anthropic_auth" ||
      error.errorCode === "openai_auth" ||
      error.errorCode === "anthropic_rate_limit" ||
      error.errorCode === "openai_rate_limit"
    ) {
      errorType = error.errorCode;
      latestAssistantRow = appendMessage("assistant", error.message);
    } else if (error.errorCode === "anthropic_unknown" || error.errorCode === "openai_unknown") {
      errorType = error.errorCode;
      latestAssistantRow = appendMessage(
        "assistant",
        `${error.message}\n\n(If this persists, check the terminal where the server is running for the full error.)`
      );
    } else {
      errorType = error.errorCode || "generic_send_error";
      latestAssistantRow = appendMessage(
        "assistant",
        "*He narrows his eyes.* I must decline for the moment; there is some disturbance in communication."
      );
    }
    trackError(errorType);
    console.error(error);
  } finally {
    clearTimeout(timeoutId);
    isSending = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    if (godfreyPttButton) {
      godfreyPttButton.disabled = false;
    }
    setTyping(false);
    messageInput.blur();
    focusLatestReplyRow(latestAssistantRow);
    if (voiceInteraction) {
      godfreyPttSubmitInFlight = false;
      messageInput.value = "";
      resetGodfreyPttVisualIdle();
      destroyGodfreySpeechRecognizer();
    }
  }
}

async function downloadConversationPdf() {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    setDownloadStatus("No conversation to download yet.", true);
    return;
  }

  if (downloadConversationButton) {
    downloadConversationButton.disabled = true;
  }
  setDownloadStatus("Preparing PDF...");

  try {
    const response = await fetch("/api/conversation-pdf", {
      ...fetchOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: conversation }),
    });

    if (!response.ok) {
      const maybeJson = await response.json().catch(() => ({}));
      throw new Error(maybeJson.error || "Unable to generate PDF.");
    }

    const pdfBlob = await response.blob();
    const blobUrl = URL.createObjectURL(pdfBlob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    const contentDisposition = response.headers.get("Content-Disposition");
    const filenameMatch = contentDisposition && contentDisposition.match(/filename="([^"]+)"/);
    anchor.download = filenameMatch ? filenameMatch[1] : "godfrey-conversation.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
    setDownloadStatus("Conversation PDF downloaded.");
    trackEvent("Conversation Downloaded PDF");
  } catch (error) {
    setDownloadStatus(error.message || "Unable to generate PDF.", true);
    trackError("pdf_download_failed");
  } finally {
    if (downloadConversationButton) {
      downloadConversationButton.disabled = false;
    }
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (!content) return;

  messageInput.value = "";
  messageInput.blur();

  await sendMessage(content);
});

messageInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

messageInput.addEventListener("input", () => {
  bumpIdleNudgeAfterUserActivity();
});

if (continueReplyButton) {
  continueReplyButton.addEventListener("click", () => {
    trackEvent("Reply Continue");
    void sendMessage("continue");
  });
}

/** Sends a finalized voice transcript through the same /api/chat path as typed input. */
async function submitGodfreyVoiceTurn(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || godfreyPttSubmitInFlight || isSending) {
    return;
  }
  godfreyPttSubmitInFlight = true;
  setGodfreyPttChrome({ processing: true });
  await sendMessage(trimmed, { voiceInteraction: true });
}

/**
 * Primary browser voice path: one tap starts Web Speech recognition; final transcript
 * auto-submits to Godfrey Brain.
 */
function setupGodfreyPushToTalk() {
  if (!godfreyPttButton) {
    return;
  }
  if (!SpeechRecognitionCtor) {
    godfreyPttButton.disabled = true;
    if (godfreyPttLabel) {
      godfreyPttLabel.textContent = "Voice not supported";
    }
    if (godfreyPttInterimLine) {
      godfreyPttInterimLine.textContent = "Web Speech API unavailable in this browser.";
    }
    return;
  }
  godfreyPttButton.addEventListener("click", onGodfreyPttClick);
}

function onGodfreyPttClick() {
  if (!godfreyPttButton || godfreyPttButton.disabled) {
    return;
  }
  if (isSending || godfreyPttSubmitInFlight) {
    return;
  }

  if (godfreyPttListening) {
    godfreyPttUserAborted = true;
    stopGodfreySpeechRecognizer();
    return;
  }

  godfreyPttUserAborted = false;
  godfreyPttReceivedFinalThisStart = false;
  godfreyNoSpeechRetryCount = 0;
  godfreyLastInterimText = "";

  destroyGodfreySpeechRecognizer();
  speechRecognizer = new SpeechRecognitionCtor();
  speechRecognizer.lang = "en-AU";
  speechRecognizer.interimResults = true;
  speechRecognizer.continuous = false;
  speechRecognizer.maxAlternatives = 1;

  speechRecognizer.onstart = () => {
    godfreyPttListening = true;
    setGodfreyPttChrome({ listening: true });
  };

  speechRecognizer.onresult = (event) => {
    let interim = "";
    let finals = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const r = event.results[i];
      const piece = r[0]?.transcript ?? "";
      if (r.isFinal) {
        finals += piece;
      } else {
        interim += piece;
      }
    }
    const interimTrim = interim.trim();
    if (interimTrim) {
      godfreyLastInterimText = interimTrim;
      if (godfreyPttInterimLine) {
        godfreyPttInterimLine.textContent = interimTrim;
      }
    }

    const finalTrim = finals.trim();
    if (!finalTrim) {
      return;
    }
    if (godfreyPttSubmitInFlight || isSending) {
      return;
    }
    const now = Date.now();
    if (finalTrim === godfreyLastFinalText && now - godfreyLastFinalAt < 420) {
      console.warn("godfrey-voice: suppressed duplicate final transcript", finalTrim);
      return;
    }
    godfreyLastFinalText = finalTrim;
    godfreyLastFinalAt = now;
    godfreyLastInterimText = "";
    if (godfreyPttInterimLine) {
      godfreyPttInterimLine.textContent = "";
    }
    messageInput.value = finalTrim;
    setGodfreyPttChrome({ processing: true });

    godfreyPttReceivedFinalThisStart = true;
    void submitGodfreyVoiceTurn(finalTrim);
  };

  speechRecognizer.onerror = (event) => {
    const err = event.error || "unknown";
    console.warn("godfrey-voice recognition error", err);
    if (err === "aborted" && godfreyPttUserAborted) {
      godfreyPttUserAborted = false;
      resetGodfreyPttVisualIdle();
      return;
    }
    if (err === "not-allowed") {
      if (godfreyPttInterimLine) {
        godfreyPttInterimLine.textContent = "Microphone permission denied — use the text box or allow access.";
      }
      resetGodfreyPttVisualIdle();
      return;
    }
    if (err === "no-speech" && godfreyNoSpeechRetryCount < 1 && speechRecognizer) {
      godfreyNoSpeechRetryCount += 1;
      try {
        speechRecognizer.start();
        return;
      } catch {
        /* fall through */
      }
    }
    if (godfreyPttInterimLine && err !== "aborted") {
      godfreyPttInterimLine.textContent =
        err === "no-speech" ? "No speech heard — tap to try again." : `Recognition ended (${err}).`;
    }
    resetGodfreyPttVisualIdle();
  };

  speechRecognizer.onend = () => {
    godfreyPttListening = false;
    if (godfreyPttUserAborted) {
      godfreyPttUserAborted = false;
      resetGodfreyPttVisualIdle();
      return;
    }
    if (godfreyPttSubmitInFlight || isSending) {
      return;
    }
    if (!godfreyPttReceivedFinalThisStart) {
      setGodfreyPttChrome({});
    }
  };

  try {
    speechRecognizer.start();
  } catch (err) {
    console.error(err);
    if (godfreyPttInterimLine) {
      godfreyPttInterimLine.textContent = "Could not start recognition.";
    }
    resetGodfreyPttVisualIdle();
  }
}

resetButton.addEventListener("click", () => {
  trackConversationEndedIfNeeded();
  clearIdleNudgeTimer();
  nudgedSinceLastUserTurn = false;
  conversation = [];
  questionsAskedThisSession = 0;
  hasTrackedConversationStart = false;
  hasTrackedConversationEnd = false;
  chatWindow.innerHTML = "";
  setContinueReplyVisible(false);
  includeDocumentsNextTurn = true;
  logSessionId = null;
  stopSpeechPlayback();
  setTyping(false);
  destroyGodfreySpeechRecognizer();
  resetGodfreyPttVisualIdle();
});

refreshContextButton.addEventListener("click", () => {
  includeDocumentsNextTurn = true;
  appendMessage(
    "assistant",
    "*He arranges a bundle of papers upon the table.* Very well - I shall consult the records afresh on my next reply."
  );
});

if (downloadConversationButton) {
  downloadConversationButton.addEventListener("click", () => {
    downloadConversationPdf();
  });
}

refreshPromptButton.addEventListener("click", () => {
  loadSystemPrompt();
});

appendPromptButton.addEventListener("click", () => {
  updateSystemPrompt("append");
});

replacePromptButton.addEventListener("click", () => {
  updateSystemPrompt("replace");
});

saveProviderButton.addEventListener("click", () => {
  saveProvider();
});

speechModeSelect.addEventListener("change", () => {
  updateSpeechPanelVisibility();
});

saveSpeechSettingsButton.addEventListener("click", () => {
  saveSpeechSettings();
});

applyBritishPresetButton.addEventListener("click", () => {
  applyStrongBritishPreset();
});

stopSpeechButton.addEventListener("click", () => {
  stopSpeechPlayback();
  setSpeechStatus("Speech stopped.");
});

if (saveSplashSettingsAdminButton) {
  saveSplashSettingsAdminButton.addEventListener("click", () => {
    saveSplashSettings();
  });
}

if (saveResponseSettingsAdminButton) {
  saveResponseSettingsAdminButton.addEventListener("click", () => {
    saveResponseSettings();
  });
}

setupGodfreyPushToTalk();

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = populateSimpleVoices;
  populateSimpleVoices();
} else {
  simpleVoiceSelect.disabled = true;
}

(async () => {
  await loadSplashSettings();
  runSplashSequence();
  loadSpeechSettings();
  applySpeechSettingsToInputs();
  updateSpeechPanelVisibility();
  loadProvider();
  checkAdminSession();
})();

if (adminLoginButton) {
  adminLoginButton.addEventListener("click", () => {
    adminLogin();
  });
}

if (adminLogoutButton) {
  adminLogoutButton.addEventListener("click", () => {
    adminLogout();
  });
}

if (adminPasswordInput) {
  adminPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      adminLogin();
    }
  });
}

refreshLogsButton.addEventListener("click", () => {
  refreshLogFileList();
});

logFileSelect.addEventListener("change", () => {
  loadSelectedLogFile();
});

if (captainPortraitButton && portraitModal && portraitModalClose) {
  captainPortraitButton.addEventListener("click", () => {
    openPortraitModal();
  });

  portraitModalClose.addEventListener("click", () => {
    closePortraitModal();
  });

  portraitModal.addEventListener("click", (event) => {
    if (event.target === portraitModal) {
      closePortraitModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !portraitModal.classList.contains("hidden-block")) {
      closePortraitModal();
    }
  });
}

window.addEventListener("pagehide", () => {
  trackConversationEndedIfNeeded();
});
