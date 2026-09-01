/**
 * Conversation-end detection for the Unreal exhibition.
 *
 * Unreal owns the farewell transition (it waits until Godfrey has finished speaking); the Brain only
 * reports that the visitor ended the encounter. Two independent signals are combined:
 *   - the visitor's own words ("goodbye", "I must be off", …)
 *   - a [farewell] / [goodbye] cue the model chose to put in its reply
 */

/** Word-boundary markers that only appear when someone is leaving. */
const FAREWELL_PATTERNS = [
  /\bgood\s?bye\b/,
  /\bbye\b/,
  /\bbye[-\s]?bye\b/,
  /\bfarewell\b/,
  /\b(?:hope\s+to\s+)?see\s+(?:you|ya)(?:\s+(?:later|soon|around|then|again|tomorrow|tonight))?\s*$/,
  /\bso\s+long\b/,
  /\btake\s+care\b/,
  /\bgood\s+(?:day|night|evening)\s+to\s+you\b/,
  /\b(?:i|we)\s?(?:'|)?(?:m|re)?\s*(?:must|have\s+to|need\s+to|should|will|'ll)\s+(?:be\s+)?(?:go|going|leave|leaving|off)\b/,
  /\bi(?:'|’)?ve\s+got\s+to\s+(?:go|leave)\b/,
  /\bgot\s+to\s+go\b/,
  /\bgotta\s+go\b/,
  /\bhave\s+to\s+go\b/,
  /\b(?:i|we)\s?(?:'|)?m\s+off\b/,
  /\bthat\s?(?:'|)?s\s+all\b/,
  /\bthat\s+is\s+all\b/,
  /\bnothing\s+(?:else|more)\b/,
  /\bno\s+more\s+questions\b/,
  /\b(?:i|we)\s?(?:'|)?(?:m|re)?\s*(?:am|are)?\s*done\b/,
  /\bthank(?:s|\s+you)?\s+for\s+(?:your\s+)?time\b/,
];

/**
 * Greeting idiom, not a leave: "good to see you", "it's nice to see you back".
 * Stripped before the see-you farewell pattern so "see you later" still matches.
 */
const GREETING_SEE_YOU = /\b(?:it(?:'|’)?s\s+)?(?:so\s+)?(?:good|nice|great|lovely|wonderful|pleasure)\s+to\s+see\s+(?:you|ya)(?:\s+back)?\b/g;

/** Request idiom, not a leave: "I want to see you clap", "let me see you do that". */
const REQUEST_SEE_YOU = /\b(?:(?:want|like|need|love|wish|got|have)\s+to\s+|let\s+(?:me|us)\s+|can\s+(?:i|you)\s+)see\s+(?:you|ya)\b/g;

/** Longer messages are questions that merely mention leaving, not the visitor leaving. */
const MAX_FAREWELL_WORDS = 20;

function normalizeVisitorText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the visitor's last message reads as them ending the visit.
 * Questions are excluded: "did you ever say goodbye to her?" keeps the conversation going.
 * @param {string} text visitor's most recent message
 * @returns {boolean}
 */
function detectVisitorFarewellIntent(text) {
  const normalized = normalizeVisitorText(text);
  if (!normalized) {
    return false;
  }
  if (normalized.includes("?")) {
    return false;
  }
  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (wordCount > MAX_FAREWELL_WORDS) {
    return false;
  }
  const withoutSeeYouIdioms = normalized
    .replace(GREETING_SEE_YOU, " ")
    .replace(REQUEST_SEE_YOU, " ")
    .replace(/\s+/g, " ")
    .trim();
  return FAREWELL_PATTERNS.some((pattern) => pattern.test(withoutSeeYouIdioms));
}

/**
 * True when the model put a [farewell] / [goodbye] cue in its reply.
 * @param {Array<{ type?: string, value?: string }>} [performanceEvents]
 * @returns {boolean}
 */
function hasFarewellPerformanceEvent(performanceEvents) {
  if (!Array.isArray(performanceEvents)) {
    return false;
  }
  return performanceEvents.some(
    (event) => event && event.type === "state" && String(event.value || "").toLowerCase() === "farewell"
  );
}

/**
 * @param {{ visitorText?: string, performanceEvents?: Array<object> }} input
 * @returns {{ conversationEnd: boolean, conversationEndSource: string|null }}
 */
function evaluateConversationEnd({ visitorText, performanceEvents } = {}) {
  const byVisitor = detectVisitorFarewellIntent(visitorText);
  const byReplyCue = hasFarewellPerformanceEvent(performanceEvents);
  if (!byVisitor && !byReplyCue) {
    return { conversationEnd: false, conversationEndSource: null };
  }
  const source = byVisitor && byReplyCue ? "both" : byVisitor ? "visitor_phrase" : "reply_cue";
  return { conversationEnd: true, conversationEndSource: source };
}

/**
 * Prompt addendum so Godfrey actually says goodbye instead of continuing the story.
 * The exhibition mic path has no chat history, so without this he treats a goodbye as another question.
 */
function buildVisitorLeavingInstruction() {
  return [
    "## THIS VISITOR IS LEAVING (encounter over — never spoken aloud, never explained)",
    "",
    "Their last words ended the visit. Bid them a brief goodbye — use their name if you know it.",
    "One or two short sentences only. Do not continue the story. Do not ask a question.",
    "End with [farewell].",
  ].join("\n");
}

function appendVisitorLeavingInstruction(visitorContext) {
  const block = buildVisitorLeavingInstruction();
  const existing = typeof visitorContext === "string" ? visitorContext.trim() : "";
  return existing ? `${existing}\n\n${block}` : block;
}

/** Last user-authored message from a chat messages array. */
function lastVisitorMessageText(messages) {
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry && entry.role === "user" && typeof entry.content === "string" && entry.content.trim()) {
      return entry.content.trim();
    }
  }
  return "";
}

module.exports = {
  detectVisitorFarewellIntent,
  hasFarewellPerformanceEvent,
  evaluateConversationEnd,
  buildVisitorLeavingInstruction,
  appendVisitorLeavingInstruction,
  lastVisitorMessageText,
};
