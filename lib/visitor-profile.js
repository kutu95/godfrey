/**
 * Per-encounter visitor profile for the exhibition figure.
 *
 * The direct exhibition path (POST /api/godfrey/speak/stream-pcm) sends one utterance at a
 * time with no conversation history, so anything a visitor says about themselves is gone by
 * the next reply. This module keeps a small profile per encounter and renders it into a
 * prompt block, which is what lets Godfrey hold on to a name, judge how much sea-talk a
 * visitor will follow, avoid asking the same thing twice, and avoid re-reciting heavy
 * material (such as the names of the dead) he has already spoken in this encounter.
 *
 * Extraction is heuristic rather than a second model call: the direct path is latency
 * critical (see SPEECH_PIPELINE.md) and cannot afford another round trip before speaking.
 *
 * Profiles live in memory only and are never written to disk.
 */

const { detectVisitorFarewellIntent } = require("./conversation-end");
const {
  getNotableVisitorById,
  matchSurname,
  looksLikeWatchlistSurnameAttempt,
  findNotableFullMatch,
  findNotableGivenMatch,
} = require("./notable-visitors");

/** A stranger who walks up after this long is a new encounter, not the same one continuing. */
const DEFAULT_IDLE_RESET_MS = 90_000;
/** Nobody talks to a gallery figure for a quarter hour; past this the profile is stale. */
const SESSION_MAX_AGE_MS = 15 * 60_000;
const MAX_TRACKED_SESSIONS = 200;

const NAME_MAX_LENGTH = 48;

/** Particles that let a name run to three or four words (van Zeller, de la …). */
const NAME_PARTICLES = new Set([
  "van", "von", "de", "del", "della", "da", "di", "le", "la", "der", "den", "ten", "ter", "du",
]);

/** Questions Godfrey opens with, tracked so he never puts the same one twice. */
const QUESTION_KEYS = ["name", "surname", "sea", "local", "verdict"];

/**
 * Heavy topics Godfrey has already spoken this encounter. Without chat history the model
 * otherwise re-lists them when the visitor asks a related follow-up (e.g. names the dead,
 * then names them again when asked how he feels about the deaths).
 */
const TOLD_TOPIC_KEYS = ["named_the_dead"];

/** Distinct people lost on the Georgette — used only to detect a recited roster. */
const DEAD_NAME_PATTERNS = [
  /\bhauxwell\b/i,
  /\bhaxwell\b/i,
  /\bosborne\b/i,
  /\bdixon\b/i,
  /\bdavis\b/i,
  /\bherbert\b/i,
  /\bada\b/i,
  /\bfrances\b/i,
  /\bisabella\b/i,
  /\belizabeth\b/i,
  /\balexander\b/i,
];

const TOLD_TOPIC_LABELS = {
  named_the_dead:
    "the names of those who died. Do not list them again. If asked about the deaths, speak to feeling, circumstance, or the toll (eight lives; seven from the lifeboat, Herbert Osborne aboard) without re-reciting the roster",
};

/** Matches what Godfrey asked, so the next turn knows what has already been covered. */
const ASSISTANT_QUESTION_PATTERNS = {
  name: [
    /\byour name\b/i,
    /\bwhat are you called\b/i,
    /\bwhom do i (?:have the )?(?:pleasure|honour|honor)\b/i,
    /\bwho(?:m)? am i speaking\b/i,
    /\bwhat do they call you\b/i,
    /\bby what name\b/i,
    /\bwhat may i call you\b/i,
    /\bhave i the (?:pleasure|honour|honor)\b/i,
    /\band yours\b\s*\?/i,
  ],
  surname: [
    /\bfamily name\b/i,
    /\bsurname\b/i,
    /\blast name\b/i,
    /\bthe rest of (?:your|the) name\b/i,
    /\band the rest of (?:it|your name)\b/i,
    /\bwhat else are you called\b/i,
    /\byour other name\b/i,
  ],
  sea: [
    /\bbeen to sea\b/i,
    /\bgone to sea\b/i,
    /\bare you a (?:sailor|seafar|sea-?going)/i,
    /\bever sailed\b/i,
    /\bsailed yourself\b/i,
    /\bever been aboard\b/i,
    /\bfollow the sea\b/i,
    /\bknow the sea\b/i,
  ],
  local: [
    /\bknow fremantle\b/i,
    /\bof fremantle\b\??/i,
    /\bknow this coast\b/i,
    /\bfrom these parts\b/i,
    /\blive hereabouts\b/i,
    /\bknow the town\b/i,
  ],
  verdict: [
    /\bwould you have (?:put back|turned|done)\b/i,
    /\bwhat would you have done\b/i,
    /\bdone anything different\b/i,
    /\bin (?:my|your) place\b/i,
    /\b(?:don't|do not|dont) you agree\b/i,
    /\bwas(?:n't| not)? fair\b/i,
    /\bblaming (?:me|you)\b/i,
    /\byour verdict\b/i,
    /\bdo you judge me\b/i,
    /\bhow do you judge\b/i,
  ],
};

/**
 * Words that arrive where a name would and are not one. This list is what stops the figure
 * greeting someone as "Pardon" for the rest of an encounter, so it errs long.
 */
const NAME_STOPWORDS = new Set([
  "a", "afraid", "again", "an", "and", "anyway", "asking", "awful", "back", "both", "captain",
  "cheers", "cool", "curious", "dreadful", "everyone", "excuse", "fine", "from", "glad",
  "godfrey", "going", "good", "goodbye", "hello", "here", "hey", "hi", "how", "indeed",
  "interested", "just", "listening", "looking", "maybe", "morning", "no", "nobody", "none",
  "not", "nothing", "ok", "okay", "pardon", "perhaps", "please", "really", "right", "sad",
  "same", "she", "sir", "something", "sorry", "sure", "terrible", "thanks", "the", "them",
  "there", "they", "tired", "trying", "understood", "visiting", "visitor", "well", "what",
  "when", "where", "who", "why", "wondering", "wow", "yes", "you", "your",
]);

const PLACE_KEYWORDS = [
  "fremantle", "freo", "perth", "rottnest", "bunbury", "busselton", "vasse", "augusta",
  "albany", "cottesloe", "gracetown", "calgardup", "margaret river", "western australia",
  "geraldton", "champion bay", "rockingham", "garden island",
];

const sessions = new Map();

function nowMs() {
  return Date.now();
}

function idleResetMs() {
  const raw = Number(process.env.GODFREY_VISITOR_SESSION_IDLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_RESET_MS;
}

function createProfile() {
  return {
    turnCount: 0,
    name: null,
    givenName: null,
    familyName: null,
    addressAs: null,
    notableCandidateId: null,
    notableVisitorId: null,
    notableRecognitionDelivered: false,
    seaExperience: null,
    knownPlaces: [],
    isChild: false,
    inGroup: false,
    verdict: null,
    askedQuestions: [],
    topicsTold: [],
    awaiting: null,
    lastAskedTurn: 0,
    updatedAt: nowMs(),
  };
}

/** Oldest-first eviction; the store is a cache of live encounters, not a record. */
function pruneSessions() {
  const cutoff = nowMs() - SESSION_MAX_AGE_MS;
  for (const [key, entry] of sessions) {
    if (entry.updatedAt < cutoff) {
      sessions.delete(key);
    }
  }
  while (sessions.size > MAX_TRACKED_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    sessions.delete(oldestKey);
  }
}

/**
 * Unreal may hit the Brain as ::1 or ::ffff:127.0.0.1 on the same machine.
 * Treat those as one encounter or a welcome and a name land in different profiles.
 */
function normalizeClientIp(ip) {
  let value = String(ip || "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) {
    value = value.slice(7);
  }
  if (value === "::1" || value === "0:0:0:0:0:0:0:1" || value === "localhost") {
    return "127.0.0.1";
  }
  return value || "";
}

/**
 * Stable key for one encounter. Unreal does not always send a session id, so an idle gap on
 * the same client is treated as a new visitor rather than blending two people together.
 * @param {{ explicitId?: string|null, clientIp?: string|null }} input
 * @returns {string}
 */
function resolveVisitorSessionKey({ explicitId, clientIp } = {}) {
  const explicit = typeof explicitId === "string" ? explicitId.trim() : "";
  const ipKey = `ip:${normalizeClientIp(clientIp) || "unknown"}`;
  if (!explicit) {
    return ipKey;
  }
  const idKey = `id:${explicit}`;
  // The browser has no log session id on its first message, so that turn lands under the
  // client's address. Carry it across rather than starting the encounter over on turn two.
  if (!sessions.has(idKey)) {
    const orphaned = getProfile(ipKey);
    if (orphaned) {
      sessions.set(idKey, orphaned);
      sessions.delete(ipKey);
    }
  }
  return idKey;
}

/** Only keys this module issues are accepted from a request body. */
function isValidVisitorSessionKey(value) {
  return typeof value === "string" && /^(?:id|ip):[\x20-\x7e]{1,120}$/.test(value);
}

function getProfile(sessionKey) {
  pruneSessions();
  const existing = sessions.get(sessionKey);
  if (!existing) {
    return null;
  }
  if (nowMs() - existing.updatedAt > idleResetMs()) {
    sessions.delete(sessionKey);
    return null;
  }
  return existing;
}

function getOrCreateProfile(sessionKey) {
  const existing = getProfile(sessionKey);
  if (existing) {
    return existing;
  }
  const fresh = createProfile();
  sessions.set(sessionKey, fresh);
  return fresh;
}

function resetVisitorProfile(sessionKey) {
  sessions.delete(sessionKey);
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isNameParticle(word) {
  return NAME_PARTICLES.has(String(word || "").toLowerCase());
}

function isNameStopword(word) {
  const lower = String(word || "").toLowerCase();
  return NAME_STOPWORDS.has(lower) && !isNameParticle(lower);
}

function cleanNameCandidate(raw) {
  const trimmed = String(raw || "")
    .replace(/[^A-Za-z'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed || trimmed.length > NAME_MAX_LENGTH) {
    return null;
  }
  const words = trimmed.split(" ");
  const maxWords = words.some(isNameParticle) ? 4 : 2;
  if (words.length > maxWords) {
    return null;
  }
  if (words.some((word) => word.length < 2 || isNameStopword(word))) {
    return null;
  }
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Drops trailing stopwords from an explicit "my name is …" capture. */
function takeLeadingNamePhrase(raw) {
  const words = String(raw || "")
    .replace(/[^A-Za-z'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const taken = [];
  for (const word of words) {
    if (isNameStopword(word)) {
      break;
    }
    taken.push(word);
    if (taken.length >= 4) {
      break;
    }
  }
  return cleanNameCandidate(taken.join(" "));
}

/**
 * Pulls a name out of a visitor utterance.
 * `awaitingName` widens what counts: once Godfrey has asked, "Sarah Bell" is plainly an
 * answer. Unprompted, only a single word is taken, and only past the stopword list.
 * @param {string} text
 * @param {boolean} awaitingName
 * @returns {string|null}
 */
function extractName(text, awaitingName) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const explicitPatterns = [
    /\bmy name(?:'s| is)\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})/i,
    /\bname(?:'s| is)\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})/i,
    /\b(?:i am|i'm)\s+called\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})/i,
    /\bcall me\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})/i,
    /\bthis is\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})\b/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = raw.match(pattern);
    const candidate = match ? takeLeadingNamePhrase(match[1]) : null;
    if (candidate) {
      return candidate;
    }
  }

  // "I'm Sarah" is a name; "I'm from Perth" and "I'm tired" are not. Require a capital in the
  // original text so the stoplist is not doing all the work on its own.
  const iAmMatch = raw.match(/\b(?:i am|i'm)\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})\b/i);
  if (iAmMatch && /^[A-Z]/.test(iAmMatch[1])) {
    const candidate = takeLeadingNamePhrase(iAmMatch[1]);
    if (candidate) {
      return candidate;
    }
  }

  // A one-word answer is very often the visitor simply offering their name, whether or not
  // Godfrey got round to asking. Particle names (van Zeller) may run to four words.
  // A question mark means they wanted something else.
  if (!raw.includes("?")) {
    const bare = raw.replace(/[^A-Za-z'\-\s]/g, " ").trim();
    const words = bare.split(/\s+/).filter(Boolean);
    const allowParticle = words.some(isNameParticle);
    const maxWords = awaitingName || allowParticle ? (allowParticle ? 4 : 2) : 1;
    if (words.length >= 1 && words.length <= maxWords) {
      return cleanNameCandidate(bare);
    }
  }

  return null;
}

/**
 * Whether this utterance is the visitor naming themselves, not asking about someone else.
 * "Do you know Marcia van Zeller?" must not trigger recognition.
 */
function looksLikeSelfIdentification(text, awaitingIdentity) {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  if (awaitingIdentity && !raw.includes("?")) {
    return true;
  }
  if (/\b(?:my name(?:'s| is)|i am called|i'm called|call me|this is)\b/i.test(raw)) {
    return true;
  }
  if (
    /\b(?:i am|i'm)\s+[A-Z]/i.test(raw) &&
    !/\b(?:i am|i'm)\s+(?:from|not|just|here|afraid|sorry|fine|tired|interested)\b/i.test(raw)
  ) {
    return true;
  }
  if (raw.includes("?")) {
    return false;
  }
  const words = raw.replace(/[^A-Za-z'\-\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4;
}

/**
 * Family name offered on its own, once Godfrey has asked or a watchlist given-name is pending.
 * @param {string} text
 * @param {boolean} awaitingSurname
 * @returns {string|null}
 */
function extractSurnameOffer(text, awaitingSurname) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const explicit = raw.match(
    /\b(?:family name|surname|last name)(?:'s| is)?\s+([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,2})/i
  );
  if (explicit) {
    return takeLeadingNamePhrase(explicit[1]);
  }

  if (!awaitingSurname || raw.includes("?")) {
    return null;
  }

  const bare = raw.replace(/[^A-Za-z'\-\s]/g, " ").trim();
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 3) {
    return cleanNameCandidate(bare);
  }
  return null;
}

function confirmNotableVisitor(profile, entry) {
  profile.notableVisitorId = entry.id;
  profile.notableCandidateId = null;
  profile.notableRecognitionDelivered = false;
  profile.name = entry.displayName;
  profile.addressAs = entry.addressAs;
  profile.givenName = entry.addressAs;
  profile.familyName = entry.displayName.replace(new RegExp(`^${entry.addressAs}\\s+`, "i"), "") || entry.displayName;
}

function applyNotableVisitorMatch(profile, text) {
  if (profile.notableVisitorId) {
    return;
  }

  const awaitingIdentity = profile.awaiting === "name" || profile.awaiting === "surname";
  const selfId = looksLikeSelfIdentification(text, awaitingIdentity || Boolean(profile.notableCandidateId));
  const full = findNotableFullMatch(text);

  if (full && (selfId || profile.notableCandidateId === full.id)) {
    confirmNotableVisitor(profile, full);
    return;
  }

  if (profile.notableCandidateId) {
    const candidate = getNotableVisitorById(profile.notableCandidateId);
    if (candidate && matchSurname(text, candidate) && (selfId || awaitingIdentity || !String(text || "").includes("?"))) {
      confirmNotableVisitor(profile, candidate);
      return;
    }
    const offered = extractSurnameOffer(text, profile.awaiting === "surname" || Boolean(profile.notableCandidateId));
    if (offered && candidate && !matchSurname(offered, candidate) && !matchSurname(text, candidate)) {
      if (looksLikeWatchlistSurnameAttempt(offered, candidate) || looksLikeWatchlistSurnameAttempt(text, candidate)) {
        return;
      }
      profile.familyName = offered;
      const given = profile.givenName || profile.name;
      profile.name = given && given !== offered ? `${given} ${offered}` : offered;
      profile.addressAs = given || offered;
      profile.notableCandidateId = null;
    }
    return;
  }

  if (!selfId) {
    return;
  }

  const givenHit = findNotableGivenMatch(text) || findNotableGivenMatch(profile.name || "");
  if (givenHit && !matchSurname(text, givenHit)) {
    profile.notableCandidateId = givenHit.id;
    profile.givenName = givenHit.addressAs;
    if (!profile.name) {
      profile.name = givenHit.addressAs;
    }
    profile.addressAs = givenHit.addressAs;
  }
}

/**
 * How much sea-talk this visitor will follow: worked at sea, travelled as a passenger, or
 * neither. Drives whether Godfrey speaks technically or reaches for physical analogy.
 * @param {string} text
 * @returns {"experienced"|"passenger"|"none"|null}
 */
function extractSeaExperience(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }

  const deniesExperience =
    /\b(?:never|not)\b[^.?!]{0,24}\b(?:been to sea|sailed|sailing|on a (?:ship|boat)|at sea)\b/.test(normalized) ||
    /\bi(?:'m| am)? ?(?:not|no)\b[^.?!]{0,16}\bsailor\b/.test(normalized) ||
    /\bnever (?:been )?(?:on|aboard) a (?:ship|boat)\b/.test(normalized) ||
    /\blandlubber\b/.test(normalized);
  if (deniesExperience) {
    return "none";
  }

  const worked =
    /\b(?:i|we)\b[^.?!]{0,20}\b(?:served|crewed|worked)\b[^.?!]{0,20}\b(?:at sea|on ships?|on boats?|aboard|navy|merchant)\b/.test(normalized) ||
    /\b(?:royal navy|merchant navy|merchant marine|the navy)\b/.test(normalized) ||
    /\bi(?:'m| am| was)? ?(?:a )?(?:sailor|fisherman|deckhand|able seaman|skipper|ship's? engineer|marine engineer)\b/.test(normalized) ||
    /\bi(?:'ve| have)? ?(?:been )?(?:sailed|sailing)\b[^.?!]{0,20}\b(?:years|professionally|for a living)\b/.test(normalized);
  if (worked) {
    return "experienced";
  }

  const travelled =
    /\bi(?:'ve| have)? ?(?:been )?(?:sailed|sailing)\b/.test(normalized) ||
    /\bi\b[^.?!]{0,16}\b(?:sail|sailed|crewed)\b/.test(normalized) ||
    /\bbeen (?:to sea|on a (?:ship|boat|ferry|cruise)|aboard)\b/.test(normalized) ||
    /\b(?:ferry|cruise|yacht|dinghy|kayak|catamaran)\b/.test(normalized) ||
    /\bseasick\b/.test(normalized);
  if (travelled) {
    return "passenger";
  }

  return null;
}

/** Places the visitor mentions knowing, used to anchor 1877 against what they see today. */
function extractPlaces(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return [];
  }
  return PLACE_KEYWORDS.filter((place) => normalized.includes(place));
}

/** Only trusts a stated age, because guessing wrong and patronising an adult is worse. */
function extractIsChild(text) {
  const normalized = normalize(text);
  const match = normalized.match(/\bi(?:'m| am)\s+(\d{1,2})\b(?:\s+years?\s+old)?/);
  if (!match) {
    return false;
  }
  const age = Number(match[1]);
  return Number.isFinite(age) && age >= 3 && age <= 14;
}

function extractInGroup(text) {
  const normalized = normalize(text);
  return (
    /\bwe(?:'re| are)?\b/.test(normalized) ||
    /\bmy (?:mum|mom|dad|brother|sister|friend|class|teacher|family|kids|children)\b/.test(normalized) ||
    /\bour class\b/.test(normalized) ||
    /\bschool (?:trip|group|excursion)\b/.test(normalized)
  );
}

/** Read only when Godfrey has actually asked for a judgement. */
function extractVerdict(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return null;
  }
  // Fairness / ally questions: agreement is sympathetic.
  if (/\b(?:not fair|wasn't fair|was not fair|unfair|scapegoat|i agree|you're right|you are right|blameless)\b/.test(normalized)) {
    return "sympathetic";
  }
  if (/\b(?:not your fault|no fault|you did (?:all|what) you could|i would have done the same|nothing else you could|i wouldn't have done (?:anything )?different)\b/.test(normalized)) {
    return "sympathetic";
  }
  if (/\b(?:you should have|your fault|you were wrong|you failed|i would have (?:put back|turned|done differently)|you ought to have|it was fair)\b/.test(normalized)) {
    return "critical";
  }
  // Bare yes/no is ambiguous across "would you have done differently?" vs "wasn't blaming fair?" — skip.
  if (/\b(?:hard to say|difficult to say|i don't know|cannot say|both|mixed|partly)\b/.test(normalized)) {
    return "undecided";
  }
  return null;
}

/** Which of Godfrey's opening questions this reply contains, so he does not repeat them. */
function detectAssistantQuestions(assistantText) {
  const text = String(assistantText || "");
  if (!text) {
    return [];
  }
  return QUESTION_KEYS.filter((key) =>
    ASSISTANT_QUESTION_PATTERNS[key].some((pattern) => pattern.test(text))
  );
}

/**
 * Heavy material already spoken this encounter (no chat history on the exhibition path).
 * A roster of the dead is detected when several distinct lost names appear in one reply.
 * @param {string} assistantText
 * @returns {string[]}
 */
function detectToldTopics(assistantText) {
  const text = String(assistantText || "");
  if (!text) {
    return [];
  }
  const told = [];
  const deadHits = DEAD_NAME_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );
  // Three or more distinct dead-name hits = a recited list, not a passing mention.
  if (deadHits >= 3) {
    told.push("named_the_dead");
  }
  return told;
}

/**
 * Folds one visitor utterance into the encounter profile and returns it.
 * @param {string} sessionKey
 * @param {string} visitorText
 * @returns {object} the updated profile
 */
function ingestVisitorTurn(sessionKey, visitorText) {
  const profile = getOrCreateProfile(sessionKey);
  const text = String(visitorText || "").trim();
  profile.turnCount += 1;
  profile.updatedAt = nowMs();

  if (!text) {
    return profile;
  }

  if (!profile.name) {
    const name = extractName(text, profile.awaiting === "name");
    if (name) {
      profile.name = name;
    }
  }

  applyNotableVisitorMatch(profile, text);

  const seaExperience = extractSeaExperience(text);
  // "I worked on ships" outranks a later "I was on a ferry once"; do not downgrade.
  if (seaExperience && (profile.seaExperience !== "experienced" || seaExperience === "experienced")) {
    profile.seaExperience = seaExperience;
  }

  for (const place of extractPlaces(text)) {
    if (!profile.knownPlaces.includes(place)) {
      profile.knownPlaces.push(place);
    }
  }

  if (extractIsChild(text)) {
    profile.isChild = true;
  }
  if (extractInGroup(text)) {
    profile.inGroup = true;
  }

  if (profile.awaiting === "verdict" && !profile.verdict) {
    profile.verdict = extractVerdict(text);
  }

  profile.awaiting = null;
  return profile;
}

/**
 * Records what Godfrey asked, and clears the encounter when the visitor has left so the next
 * person to walk up is a stranger again.
 * @param {string} sessionKey
 * @param {string} assistantText
 * @param {{ visitorText?: string }} [context]
 */
function ingestAssistantTurn(sessionKey, assistantText, { visitorText } = {}) {
  const profile = getProfile(sessionKey);
  if (!profile) {
    return;
  }

  const asked = detectAssistantQuestions(assistantText);
  for (const key of asked) {
    if (!profile.askedQuestions.includes(key)) {
      profile.askedQuestions.push(key);
    }
  }
  profile.awaiting = asked.length === 1 ? asked[0] : null;
  if (asked.length > 0) {
    profile.lastAskedTurn = profile.turnCount;
  }

  if (!Array.isArray(profile.topicsTold)) {
    profile.topicsTold = [];
  }
  for (const topic of detectToldTopics(assistantText)) {
    if (!profile.topicsTold.includes(topic)) {
      profile.topicsTold.push(topic);
    }
  }
  profile.updatedAt = nowMs();

  const leaving =
    detectVisitorFarewellIntent(visitorText) || /\[(?:farewell|goodbye)\]/i.test(String(assistantText || ""));
  if (leaving) {
    resetVisitorProfile(sessionKey);
  }
}

/**
 * Where the encounter has got to. Godfrey is guarded with a stranger and opens up as the
 * conversation goes on, which is what makes him read as a person rather than a lookup.
 * @param {number} turnCount
 * @returns {"opening"|"early"|"middle"|"late"}
 */
function encounterStage(turnCount) {
  if (turnCount <= 1) {
    return "opening";
  }
  if (turnCount <= 4) {
    return "early";
  }
  if (turnCount <= 9) {
    return "middle";
  }
  return "late";
}

const SEA_EXPERIENCE_NOTES = {
  experienced: "has worked at sea — speak technically, do not explain your terms",
  passenger: "has travelled by sea but never worked it — a crossing of their own is your way in",
  none: "has never been to sea — reach for what a body knows, not for sea terms",
};

const VERDICT_NOTES = {
  sympathetic: "has judged in your favour — it moves you more than you will show",
  critical: "has judged against you — take it without argument; you asked for it",
  undecided: "would not be drawn to a verdict",
};

const QUESTION_LABELS = {
  name: "their name",
  surname: "their family name",
  sea: "whether they have been to sea",
  local: "whether they know Fremantle or this coast",
  verdict: "their verdict on you",
};

/**
 * The one thing most worth learning next, or null when Godfrey should simply answer.
 * Without this he tends to keep offering the story and never asks anything at all.
 * @param {object} profile
 * @param {string} stage
 * @returns {string|null}
 */
function nextQuestionNudge(profile, stage) {
  const asked = (key) => profile.askedQuestions.includes(key);

  // Watchlist given-name: ask the family name on this same reply, before the usual one-turn wait.
  if (profile.notableCandidateId && !profile.notableVisitorId && !asked("surname")) {
    const candidate = getNotableVisitorById(profile.notableCandidateId);
    return (
      candidate?.pendingSurnameNudge ||
      "Ask once, naturally, for their family name — not as an interrogation, and do not explain why you ask."
    );
  }

  // He asked something last turn; the hosting rules give the visitor a turn in peace.
  if (profile.lastAskedTurn > 0 && profile.turnCount <= profile.lastAskedTurn + 1) {
    return null;
  }

  if (!profile.name && !asked("name")) {
    return "You do not know their name and have not asked. Give your own and ask theirs, at a natural break — not in the middle of an answer.";
  }
  if (!profile.seaExperience && !asked("sea") && stage !== "opening") {
    return "You do not know whether they have been to sea. Worth asking; it decides how you speak to them.";
  }
  if (profile.knownPlaces.length === 0 && !asked("local") && (stage === "middle" || stage === "late")) {
    return "You do not know whether they know Fremantle or this coast. Worth asking.";
  }
  if (!profile.verdict && !asked("verdict") && (stage === "middle" || stage === "late")) {
    return "You are looking for an ally. Lay out briefly that one name had to be written down and it was yours, then ask one of: what would they have done in your place; would they have done anything different; or whether blaming you alone was fair. Do not beg. Make them answer.";
  }
  return null;
}

/**
 * Renders the profile as a prompt block. Returns "" when there is nothing worth spending
 * tokens on, which is the common case on the first exchange.
 * @param {object|null} profile
 * @returns {string}
 */
function buildVisitorContextBlock(profile) {
  if (!profile) {
    return "";
  }

  const lines = [];
  const stage = encounterStage(profile.turnCount);
  lines.push(`This is exchange ${profile.turnCount} of the encounter. Stage: ${stage}.`);

  const known = [];
  if (profile.name) {
    const address = profile.addressAs || profile.name;
    known.push(
      `- Name: ${profile.name}. Address them as ${address} in about one reply in three when the answer has weight (e.g. "Well, ${address}, …"). Never every reply.`
    );
  }
  if (profile.notableVisitorId) {
    const notable = getNotableVisitorById(profile.notableVisitorId);
    if (profile.notableRecognitionDelivered) {
      if (notable?.knownNotes) {
        known.push(`- ${notable.knownNotes}`);
      }
    } else if (notable?.recognitionPendingNotes) {
      known.push(`- ${notable.recognitionPendingNotes}`);
    }
  }
  if (profile.seaExperience) {
    known.push(`- The sea: ${SEA_EXPERIENCE_NOTES[profile.seaExperience]}.`);
  }
  if (profile.knownPlaces.length > 0) {
    known.push(
      `- Knows: ${profile.knownPlaces.join(", ")}. You know these places as they stand in 1877 and no later.`
    );
    if (profile.knownPlaces.includes("busselton")) {
      known.push(
        "- Visitor said Busselton. That is the town's name in your time (gazetted 1847). The inquiry sat at the Busselton Courthouse. You may also say the Vasse for the district or port call."
      );
    }
  }
  if (profile.isChild) {
    known.push("- A child. Keep it short and plain, and do not dwell on the drowned unless they ask.");
  }
  if (profile.inGroup) {
    known.push("- Not alone. You may address the others with them.");
  }
  if (profile.verdict) {
    known.push(`- Verdict: ${VERDICT_NOTES[profile.verdict]}.`);
  }
  if (known.length > 0) {
    lines.push("What you have learned of them:");
    lines.push(...known);
  }

  if (profile.askedQuestions.length > 0) {
    const labels = profile.askedQuestions.map((key) => QUESTION_LABELS[key]).filter(Boolean);
    lines.push(`Already asked this encounter — do not ask again: ${labels.join("; ")}.`);
  }

  const topicsTold = Array.isArray(profile.topicsTold) ? profile.topicsTold : [];
  if (topicsTold.length > 0) {
    const labels = topicsTold.map((key) => TOLD_TOPIC_LABELS[key]).filter(Boolean);
    if (labels.length > 0) {
      lines.push(`Already told this encounter — do not recite again: ${labels.join("; ")}.`);
    }
  }

  if (profile.awaiting && QUESTION_LABELS[profile.awaiting]) {
    lines.push(`You have just asked ${QUESTION_LABELS[profile.awaiting]} and are waiting on the answer.`);
  } else {
    const nudge = nextQuestionNudge(profile, stage);
    if (nudge) {
      lines.push(nudge);
    }
  }

  return `## THIS VISITOR (encounter state — never spoken aloud, never explained)\n\n${lines.join("\n")}`;
}

/** Convenience for callers that hold a key rather than a profile. */
function buildVisitorContextBlockForSession(sessionKey) {
  return buildVisitorContextBlock(getProfile(sessionKey));
}

/**
 * Authored recognition is due this turn (confirmed notable visitor, not yet spoken).
 * @param {string} sessionKey
 * @returns {object|null} notable visitor entry, or null
 */
function peekPendingNotableRecognition(sessionKey) {
  const profile = getProfile(sessionKey);
  if (!profile?.notableVisitorId || profile.notableRecognitionDelivered) {
    return null;
  }
  return getNotableVisitorById(profile.notableVisitorId);
}

function markNotableRecognitionDelivered(sessionKey) {
  const profile = getProfile(sessionKey);
  if (!profile) {
    return;
  }
  profile.notableRecognitionDelivered = true;
  profile.updatedAt = nowMs();
}

module.exports = {
  QUESTION_KEYS,
  TOLD_TOPIC_KEYS,
  resolveVisitorSessionKey,
  isValidVisitorSessionKey,
  ingestVisitorTurn,
  ingestAssistantTurn,
  buildVisitorContextBlock,
  buildVisitorContextBlockForSession,
  peekPendingNotableRecognition,
  markNotableRecognitionDelivered,
  resetVisitorProfile,
  encounterStage,
  extractName,
  extractSurnameOffer,
  extractSeaExperience,
  extractPlaces,
  extractVerdict,
  detectAssistantQuestions,
  detectToldTopics,
  looksLikeSelfIdentification,
  normalizeClientIp,
};
