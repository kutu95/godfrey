/**
 * Performance text: strip cues for ElevenLabs; parse cues for Unreal / exhibition metadata.
 */

const BRACKET_PAUSE_BY_INNER = new Map([
  ["pause", "normal"],
  ["short pause", "short"],
  ["quiet pause", "quiet"],
  ["long pause", "long"],
]);

/** Unreal performer / mood routing (square brackets, single token). */
const BRACKET_PERFORMER_BY_INNER = new Map([
  ["thinking", "thinking"],
  ["serious", "serious"],
  ["amused", "amused"],
  ["emphasis", "emphasis"],
  ["idle", "idle"],
]);

const ASTERISK_BY_INNER = new Map([
  ["looks down", { type: "gaze", value: "down" }],
  ["looks away", { type: "gaze", value: "away" }],
  ["glances toward the horizon", { type: "gaze", value: "horizon" }],
  ["slight tired smile", { type: "expression", value: "tired_smile" }],
  ["frowns faintly", { type: "expression", value: "faint_frown" }],
  ["straightens slightly", { type: "posture", value: "straighten" }],
  ["leans forward slightly", { type: "posture", value: "lean_forward" }],
]);

function normalizeCueInner(inner) {
  return String(inner)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function unknownMachineValue(inner) {
  return normalizeCueInner(inner).replace(/\s+/g, "_");
}

/** True only for known Godfrey performer/pause markers (not arbitrary [brackets]). */
function isPerformanceCueMarker(raw) {
  if (!raw || typeof raw !== "string") {
    return false;
  }
  if (raw.startsWith("*") && raw.endsWith("*") && raw.length > 2) {
    return true;
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = normalizeCueInner(raw.slice(1, -1));
    return BRACKET_PAUSE_BY_INNER.has(inner) || BRACKET_PERFORMER_BY_INNER.has(inner);
  }
  return false;
}

/** Remove admin / UI suffixes before exhibition queue or segmentation. */
function prepareExhibitionPerformanceText(text) {
  let out = String(text || "").trim();
  out = out.replace(/\n\n\[Reply limited to \d+ words by admin setting\.\]\s*$/i, "");
  out = out.replace(/\n\n\[Reply clipped by response limit[^\]]*\]\s*$/i, "");
  return out.trim();
}

/**
 * Strips *asterisk* and [bracket] performance cues for ElevenLabs only.
 * @param {string} text
 * @returns {string}
 */
function stripPerformanceCues(text) {
  if (!text || typeof text !== "string") {
    return "";
  }
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/\*[^*]*\*/g, " ").replace(/\[[^\]]*\]/g, " ");
  } while (out !== prev);

  return out
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {string} [performanceText]
 * @returns {Array<{ type: string, value: string, raw: string, index: number }>}
 */
function parsePerformanceEvents(performanceText) {
  const text = performanceText == null ? "" : String(performanceText);
  /** @type {{ index: number, raw: string }[]} */
  const hits = [];

  for (const m of text.matchAll(/\[[^\]]*\]/g)) {
    hits.push({ index: m.index, raw: m[0] });
  }
  for (const m of text.matchAll(/\*[^*]+\*/g)) {
    hits.push({ index: m.index, raw: m[0] });
  }

  hits.sort((a, b) => a.index - b.index || a.raw.localeCompare(b.raw));

  /** @type {Array<{ type: string, value: string, raw: string, index: number }>} */
  const events = [];

  for (const { index, raw } of hits) {
    const isBracket = raw.startsWith("[");
    const inner = isBracket ? raw.slice(1, -1) : raw.slice(1, -1);
    const norm = normalizeCueInner(inner);

    if (!norm) {
      events.push({ type: "unknown", value: "", raw, index });
      continue;
    }

    if (isBracket) {
      const pauseValue = BRACKET_PAUSE_BY_INNER.get(norm);
      if (pauseValue !== undefined) {
        events.push({ type: "pause", value: pauseValue, raw, index });
        continue;
      }
      const performerValue = BRACKET_PERFORMER_BY_INNER.get(norm);
      if (performerValue !== undefined) {
        events.push({ type: "performer", value: performerValue, raw, index });
        continue;
      }
      events.push({ type: "unknown", value: unknownMachineValue(inner), raw, index });
      continue;
    }

    const mapped = ASTERISK_BY_INNER.get(norm);
    if (mapped) {
      events.push({ type: mapped.type, value: mapped.value, raw, index });
    } else {
      events.push({ type: "unknown", value: unknownMachineValue(inner), raw, index });
    }
  }

  return events;
}

function runSelfTest() {
  const sample = `[long pause]
*looks down*
Aye… I remember them still.`;

  const ev = parsePerformanceEvents(sample);
  const summary = ev.map((e) => `${e.type} ${e.value}`).join(", ");
  console.log("parsePerformanceEvents self-test sample events:", summary);
  if (ev.length !== 2 || ev[0].type !== "pause" || ev[0].value !== "long" || ev[1].type !== "gaze" || ev[1].value !== "down") {
    console.error("parsePerformanceEvents self-test FAILED", ev);
    process.exitCode = 1;
    return;
  }
  console.log("parsePerformanceEvents self-test OK");

  const roundTrip = JSON.parse(JSON.stringify(ev));
  if (roundTrip.length !== 2) {
    console.error("JSON round-trip FAILED");
    process.exitCode = 1;
  }

  const adminFixture = `[thinking]
[serious]
[short pause]
*looks down*
*leans forward slightly*
We hold to our course.`;

  const ev2 = parsePerformanceEvents(adminFixture);
  const expected = [
    ["performer", "thinking"],
    ["performer", "serious"],
    ["pause", "short"],
    ["gaze", "down"],
    ["posture", "lean_forward"],
  ];
  let ok2 = ev2.length === expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    if (!ev2[i] || ev2[i].type !== expected[i][0] || ev2[i].value !== expected[i][1]) {
      ok2 = false;
    }
  }
  const stripped = stripPerformanceCues(adminFixture);
  const noMarkers = !/\[|\]|\*/.test(stripped);
  const hasSpoken = /We hold to our course/.test(stripped);
  if (!ok2 || !noMarkers || !hasSpoken) {
    console.error("strip/parse integration self-test FAILED", { ev2, stripped, noMarkers, hasSpoken });
    process.exitCode = 1;
    return;
  }
  console.log("strip + extended parse self-test OK");
}

module.exports = {
  stripPerformanceCues,
  parsePerformanceEvents,
  isPerformanceCueMarker,
  prepareExhibitionPerformanceText,
};

if (require.main === module) {
  runSelfTest();
}
