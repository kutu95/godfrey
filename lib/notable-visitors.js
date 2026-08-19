/**
 * Exhibition watchlist of visitors Godfrey may recognise from what they say.
 *
 * Matching is heuristic and latency-cheap (no extra model call). Webcam presence
 * does not identify anyone. Prefer a missed identification over greeting the wrong
 * person.
 *
 * Config: config/notable-visitors.json (re-read on each load so edits apply without
 * a Brain restart).
 */

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "notable-visitors.json");

function normalizePersonName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[-_']/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystackNormalized, phrase) {
  const needle = normalizePersonName(phrase);
  if (!needle) {
    return false;
  }
  const pattern = new RegExp(`(?:^|\\s)${needle.replace(/\s+/g, "\\s+")}(?:\\s|$)`);
  return pattern.test(haystackNormalized);
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const normalized = normalizePersonName(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sanitizeVisitor(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  const givenNames = sanitizeStringList(raw.givenNames);
  const surnames = sanitizeStringList(raw.surnames);
  if (!id || !displayName || givenNames.length === 0 || surnames.length === 0) {
    return null;
  }
  const addressAs =
    typeof raw.addressAs === "string" && raw.addressAs.trim() ? raw.addressAs.trim() : displayName.split(/\s+/)[0];
  const occasionId =
    typeof raw.occasionId === "string" && raw.occasionId.trim() ? raw.occasionId.trim() : null;
  return {
    id,
    displayName,
    addressAs,
    givenNames,
    surnames,
    occasionId,
    pendingSurnameNudge:
      typeof raw.pendingSurnameNudge === "string" && raw.pendingSurnameNudge.trim()
        ? raw.pendingSurnameNudge.trim()
        : null,
    recognitionPendingNotes:
      typeof raw.recognitionPendingNotes === "string" && raw.recognitionPendingNotes.trim()
        ? raw.recognitionPendingNotes.trim()
        : null,
    knownNotes:
      typeof raw.knownNotes === "string" && raw.knownNotes.trim() ? raw.knownNotes.trim() : null,
    ttsSpellings:
      raw.ttsSpellings && typeof raw.ttsSpellings === "object" && !Array.isArray(raw.ttsSpellings)
        ? Object.fromEntries(
            Object.entries(raw.ttsSpellings)
              .filter(([written, spoken]) => typeof written === "string" && typeof spoken === "string")
              .map(([written, spoken]) => [written.trim(), spoken.trim()])
              .filter(([written, spoken]) => written && spoken)
          )
        : {},
  };
}

function loadNotableVisitors() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const list = Array.isArray(parsed?.visitors) ? parsed.visitors : [];
    return list.map(sanitizeVisitor).filter(Boolean);
  } catch (error) {
    console.error("notable-visitors: failed to load config:", error.message);
    return [];
  }
}

function getNotableVisitorById(id) {
  const wanted = String(id || "").trim();
  if (!wanted) {
    return null;
  }
  return loadNotableVisitors().find((entry) => entry.id === wanted) || null;
}

function levenshtein(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) {
    return 0;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    grid[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    grid[0][j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost
      );
    }
  }
  return grid[left.length][right.length];
}

function matchGivenName(text, entry) {
  const haystack = normalizePersonName(text);
  if (!haystack || !entry) {
    return false;
  }
  return entry.givenNames.some((name) => containsPhrase(haystack, name));
}

function matchSurname(text, entry) {
  const haystack = normalizePersonName(text);
  if (!haystack || !entry) {
    return false;
  }
  if (entry.surnames.some((name) => containsPhrase(haystack, name))) {
    return true;
  }
  const tokens = haystack.split(" ").filter(Boolean);
  const collapsedAliases = entry.surnames.map((name) => name.replace(/\s+/g, "")).filter((name) => name.length >= 5);
  for (const token of tokens) {
    const collapsed = token.replace(/\s+/g, "");
    if (collapsed.length < 5) {
      continue;
    }
    for (const alias of collapsedAliases) {
      const maxDist = alias.length >= 8 ? 3 : 2;
      if (levenshtein(collapsed, alias) <= maxDist) {
        return true;
      }
    }
  }
  return false;
}

function looksLikeWatchlistSurnameAttempt(text, entry) {
  const haystack = normalizePersonName(text).replace(/\s+/g, "");
  if (!haystack) {
    return false;
  }
  if (haystack.startsWith("van") && haystack.length >= 5) {
    return true;
  }
  return matchSurname(text, entry);
}

function findNotableFullMatch(text) {
  const haystack = normalizePersonName(text);
  if (!haystack) {
    return null;
  }
  return (
    loadNotableVisitors().find((entry) => matchGivenName(haystack, entry) && matchSurname(haystack, entry)) ||
    null
  );
}

function findNotableGivenMatch(text) {
  const haystack = normalizePersonName(text);
  if (!haystack) {
    return null;
  }
  const hits = loadNotableVisitors().filter((entry) => matchGivenName(haystack, entry));
  return hits.length === 1 ? hits[0] : null;
}

module.exports = {
  CONFIG_PATH,
  normalizePersonName,
  loadNotableVisitors,
  getNotableVisitorById,
  matchGivenName,
  matchSurname,
  looksLikeWatchlistSurnameAttempt,
  findNotableFullMatch,
  findNotableGivenMatch,
  levenshtein,
};
