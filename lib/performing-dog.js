/**
 * Visitor asking Godfrey to do a stunt for their amusement (clap, dance, jump…).
 * He is a ship's master on a public wharf, not a sideshow. Unreal still owns animation;
 * the Brain only refuses in character.
 */

function normalizeVisitorText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STUNT_PATTERNS = [
  /\bclapp?(?:ing)?(?:\s+(?:your\s+)?hands?)?\b/,
  /\bjump(?:ing)?\s+up(?:\s+and\s+down)?\b/,
  /\b(?:do|doing)\s+(?:a\s+)?(?:little\s+)?(?:dance|jig|trick|twirl|spin|pirouette|cartwheel|somersault|handstand)\b/,
  /\bdanc(?:e|ing)\b/,
  /\b(?:spin|twirl|hop)(?:ing)?(?:\s+(?:around|about|up(?:\s+and\s+down)?))?\b/,
  /\b(?:roll\s+over|sit\s+up(?:\s+and\s+beg)?|beg\s+for\s+me|fetch|good\s+boy|performing\s+dog|do\s+(?:me\s+)?a\s+trick|show\s+(?:me\s+)?(?:a\s+)?trick)\b/,
  /\bstand\s+on\s+(?:one\s+)?(?:one\s+)?leg\b/,
  /\bwave\s+(?:your\s+)?(?:hand|hands|arms?)\b/,
];

/** Past / biographical — "did you dance at the soirees", not a stunt now. */
const PAST_ABOUT_HIM = /\b(?:did|have|had|were|was)\s+you\b/;

function mentionsStunt(normalized) {
  return STUNT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksAimedAtHimNow(normalized) {
  if (/^(?:please\s+)?(?:clap|clapp|jump|dance|spin|twirl|hop|do|show|wave)\b/.test(normalized)) {
    return true;
  }
  if (/\b(?:can|could|will|would)\s+you\b/.test(normalized)) {
    return true;
  }
  if (/\bi\s+want\s+(?:to\s+see\s+you|you\s+to)\b/.test(normalized)) {
    return true;
  }
  if (/\b(?:for\s+me|for\s+us)\b/.test(normalized)) {
    return true;
  }
  if (/\b(?:you|godfrey|captain)\b/.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * True when the visitor is asking him to perform a physical stunt now.
 * @param {string} text
 * @returns {boolean}
 */
function detectPerformingDogRequest(text) {
  const normalized = normalizeVisitorText(text);
  if (!normalized) {
    return false;
  }
  if (!mentionsStunt(normalized)) {
    return false;
  }
  if (PAST_ABOUT_HIM.test(normalized) && !/\b(?:can|could|will|would)\s+you\b/.test(normalized)) {
    return false;
  }
  return looksAimedAtHimNow(normalized);
}

function buildPerformingDogInstruction() {
  return [
    "## THIS VISITOR IS MAKING A FOOL OF YOU (never spoken aloud, never explained)",
    "",
    "They asked you to perform a stunt — clap, dance, jump, a trick — as if you were a performing dog on a quay.",
    "You are a ship's master, not a sideshow. Refuse. Dry, short, a little cold.",
    "Do not clap, dance, jump, or play along \"just this once\". Do not offer to do it. Do not ask why they asked.",
    "One or two sentences. Something in this vein (vary the wording; do not recite a slogan every time):",
    "I don't much feel like being your performing dog.",
    "Then wait. Do not ask a question. Do not treat this as a goodbye.",
  ].join("\n");
}

function appendPerformingDogInstruction(visitorContext) {
  const block = buildPerformingDogInstruction();
  const existing = typeof visitorContext === "string" ? visitorContext.trim() : "";
  return existing ? `${existing}\n\n${block}` : block;
}

module.exports = {
  detectPerformingDogRequest,
  buildPerformingDogInstruction,
  appendPerformingDogInstruction,
};
