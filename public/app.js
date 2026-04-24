const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const voiceInputButton = document.getElementById("voiceInputButton");
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
const continueReplyRow = document.getElementById("continueReplyRow");
const continueReplyButton = document.getElementById("continueReplyButton");

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
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognizer = null;
let isListening = false;
let simpleSpeechVoices = [];
let activeAudio = null;
let activeAudioUrl = null;

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
};
let speechSettings = JSON.parse(JSON.stringify(defaultSpeechSettings));

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
    speakAssistantReply(line);
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

function setVoiceListening(isActive) {
  isListening = isActive;
  if (!voiceInputButton) return;
  voiceInputButton.textContent = isActive ? "Stop Dictation" : "Dictate";
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

  if (speechSettings.simple.voiceName && simpleSpeechVoices.some((v) => v.name === speechSettings.simple.voiceName)) {
    simpleVoiceSelect.value = speechSettings.simple.voiceName;
  }
}

function updateSpeechPanelVisibility() {
  const mode = speechModeSelect.value;
  simpleSpeechSettings.style.display = mode === "simple" ? "flex" : "none";
  openaiSpeechSettings.style.display = mode === "openai" ? "flex" : "none";
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
    };
  } catch (error) {
    console.warn("Unable to read stored speech settings, using defaults.", error);
  }
}

function saveSpeechSettings() {
  speechSettings = readSpeechSettingsFromInputs();
  localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(speechSettings));
  updateSpeechPanelVisibility();
  setSpeechStatus("Speech settings saved.");
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

function speakAssistantReply(text) {
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
    speakWithOpenAI(cleaned);
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

async function sendMessage(content) {
  if (isSending) return;
  setContinueReplyVisible(false);
  clearIdleNudgeTimer();
  nudgedSinceLastUserTurn = false;
  isSending = true;
  let latestAssistantRow = null;
  trackConversationStartedIfNeeded();
  questionsAskedThisSession += 1;
  trackEvent("Question Asked", { question_length: content.length });
  conversation.push({ role: "user", content });
  appendMessage("user", content);

  setTyping(true);
  sendButton.disabled = true;
  messageInput.disabled = true;

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
    speakAssistantReply(captainReply);
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
    setTyping(false);
    messageInput.blur();
    focusLatestReplyRow(latestAssistantRow);
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

if (SpeechRecognition && voiceInputButton) {
  speechRecognizer = new SpeechRecognition();
  speechRecognizer.lang = "en-AU";
  speechRecognizer.interimResults = false;
  speechRecognizer.maxAlternatives = 1;

  speechRecognizer.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    const existingText = messageInput.value.trim();
    messageInput.value = existingText ? `${existingText} ${transcript}` : transcript;
    messageInput.focus();
  };

  speechRecognizer.onend = () => {
    setVoiceListening(false);
  };

  speechRecognizer.onerror = () => {
    setVoiceListening(false);
  };

  voiceInputButton.addEventListener("click", () => {
    if (isListening) {
      speechRecognizer.stop();
      return;
    }
    setVoiceListening(true);
    speechRecognizer.start();
  });
} else if (voiceInputButton) {
  voiceInputButton.disabled = true;
  voiceInputButton.textContent = "Voice Unsupported";
  voiceInputButton.title = "Speech recognition is not supported in this browser.";
}

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
