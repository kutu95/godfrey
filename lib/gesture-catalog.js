/**
 * Unreal Godfrey performance gesture catalog for Brain prompt + cue validation.
 *
 * Source of truth (UE): MetaHuman_Baseline_UE58_Test/Config/GodfreyPerformanceActionCatalog.json
 * Local copy: config/godfrey-performance-action-catalog.json (with LLM descriptions)
 */

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "..", "config", "godfrey-performance-action-catalog.json");

/** @type {{ version?: number, actions?: Array<{ id: string, description?: string } | string> } | null} */
let cachedCatalog = null;
/** @type {Set<string> | null} */
let cachedIdSet = null;

function loadCatalog() {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  if (!fs.existsSync(CATALOG_PATH)) {
    console.warn("gesture-catalog: missing", CATALOG_PATH);
    cachedCatalog = { version: 0, actions: [] };
    cachedIdSet = new Set();
    return cachedCatalog;
  }
  try {
    // The UE-side catalog is authored with a BOM; JSON.parse rejects it.
    cachedCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8").replace(/^\uFEFF/, ""));
  } catch (error) {
    console.error("gesture-catalog: failed to parse", CATALOG_PATH, error);
    cachedCatalog = { version: 0, actions: [] };
  }
  cachedIdSet = null;
  return cachedCatalog;
}

function normalizeActionId(id) {
  let stem = String(id || "").trim();
  if (!stem) {
    return "";
  }
  if (/^AS_/i.test(stem)) {
    stem = stem.slice(3);
  } else if (/^AM_/i.test(stem)) {
    stem = stem.slice(3);
  }
  return stem;
}

function getActionEntries() {
  const catalog = loadCatalog();
  const raw = Array.isArray(catalog.actions) ? catalog.actions : [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return { id: normalizeActionId(entry), description: "" };
      }
      if (entry && typeof entry.id === "string") {
        return {
          id: normalizeActionId(entry.id),
          description: typeof entry.description === "string" ? entry.description : "",
        };
      }
      return null;
    })
    .filter((e) => e && e.id);
}

function getAllowedActionIds() {
  return getActionEntries().map((e) => e.id);
}

function getAllowedActionIdSet() {
  if (!cachedIdSet) {
    cachedIdSet = new Set(getAllowedActionIds().map((id) => id.toLowerCase()));
  }
  return cachedIdSet;
}

function isKnownActionId(id) {
  const stem = normalizeActionId(id);
  if (!stem) {
    return false;
  }
  return getAllowedActionIdSet().has(stem.toLowerCase());
}

/**
 * Canonical stem casing from catalog (preserves authored ids).
 * @param {string} id
 * @returns {string}
 */
function resolveCanonicalActionId(id) {
  const stem = normalizeActionId(id);
  if (!stem) {
    return "";
  }
  const found = getActionEntries().find((e) => e.id.toLowerCase() === stem.toLowerCase());
  return found ? found.id : stem;
}

/**
 * System-prompt addendum listing valid Unreal montage actions.
 * @returns {string}
 */
function buildGestureCatalogAddendum() {
  const entries = getActionEntries();
  if (entries.length === 0) {
    return `## UNREAL GESTURE LIBRARY
No gesture catalog loaded. Prefer coarse states only: [thinking], [serious], [amused], [emphasis], [idle].`;
  }

  const lines = entries.map((e) =>
    e.description ? `- ${e.id} — ${e.description}` : `- ${e.id}`
  );

  return `## UNREAL GESTURE LIBRARY (body montages)

You may cue named body performances for the lifelike Unreal figure. The visitor never hears these markers.

Preferred named-action marker (choose ids ONLY from this list):
[gesture:TwoThumbsUp_01]

Also accepted: [action:CatalogId] or [CatalogId] when CatalogId is listed below.

Coarse mood/state (not catalog ids): [thinking], [serious], [amused], [emphasis], [idle], [farewell]
Pacing: [pause], [short pause], [long pause], [quiet pause]

Rules for gestures:
1. At most 1–3 total cues per normal answer (brackets + asterisks combined). Prefer at most ONE named [gesture:…] per reply.
2. Do not invent CatalogIds. If unsure, use a coarse state or omit the gesture.
3. Place [gesture:…] before the spoken beat it supports, not mid-sentence.
4. Unreal blends ~0.2s and layers upper body only — do not stack rapid incompatible gestures.
5. Prefer these newer takes when they fit (use them often; do not default to SpeakingCalmExplanation_01):
   - [gesture:Explaining_01] / [gesture:Explaining_02] — making something clear
   - [gesture:ExplainingFirmly_01] — plain and firm, not angry
   - [gesture:DescribingWhere_01] — place, bearing, where something lay
   - [gesture:WantingToBeUnderstood_01] — needing them to grasp why he acted so
   - [gesture:SummingUpHisCase_01] — a plea to understand him / see it fair (not a courtroom summation)
6. When the visitor says goodbye / ends the visit, emit [farewell] or [gesture:FarewellWave_01] once.
7. Prefer [gesture:HandsBehindBack_01] over [gesture:HandsClasped_01] for formal composure (long coat clips on clasped hands).
8. Do not use *looks down* or *frowns faintly* on neutral or factual answers; reserve for genuinely sombre beats.
9. If they ask you to clap, dance, jump, or do a trick, do not play a stunt gesture. Refuse in speech only.
10. Do not cue GreetingWelcome_01 / _02 / _03 — Unreal owns Welcome.

Catalog (${entries.length} actions):
${lines.join("\n")}`;
}

function reloadGestureCatalog() {
  cachedCatalog = null;
  cachedIdSet = null;
  return loadCatalog();
}

module.exports = {
  CATALOG_PATH,
  loadCatalog,
  getAllowedActionIds,
  isKnownActionId,
  resolveCanonicalActionId,
  normalizeActionId,
  buildGestureCatalogAddendum,
  reloadGestureCatalog,
};
