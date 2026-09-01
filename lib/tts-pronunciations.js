/**
 * Whole-word respellings for ElevenLabs. Global map plus any notable-visitor overlays.
 */

const fs = require("fs");
const path = require("path");
const { loadNotableVisitors } = require("./notable-visitors");

const CONFIG_PATH = path.join(__dirname, "..", "config", "tts-pronunciations.json");

function loadGlobalSpellings() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const spellings = raw && typeof raw.spellings === "object" && !Array.isArray(raw.spellings) ? raw.spellings : {};
    return Object.fromEntries(
      Object.entries(spellings)
        .filter(([written, spoken]) => written && spoken)
        .map(([written, spoken]) => [String(written), String(spoken)])
    );
  } catch {
    return {};
  }
}

function collectTtsSpellings() {
  const map = loadGlobalSpellings();
  for (const entry of loadNotableVisitors()) {
    for (const [written, spoken] of Object.entries(entry.ttsSpellings || {})) {
      map[written] = spoken;
    }
  }
  return map;
}

function applyTtsPronunciations(text) {
  let out = String(text || "");
  if (!out) {
    return out;
  }
  // ElevenLabs turbo can hitch on curly apostrophes and em-dashes
  // (Welcome: "Name's Godfrey — John Godfrey").
  out = out
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, ", ");
  const spellings = collectTtsSpellings();
  const entries = Object.entries(spellings).sort((a, b) => b[0].length - a[0].length);
  for (const [written, spoken] of entries) {
    const pattern = new RegExp(`\\b${written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(pattern, spoken);
  }
  return out;
}

module.exports = {
  CONFIG_PATH,
  applyTtsPronunciations,
};
