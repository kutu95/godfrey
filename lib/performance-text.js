/**
 * Performance text: strip cues for ElevenLabs; parse cues for Unreal / exhibition metadata.
 */

const {
  isKnownActionId,
  resolveCanonicalActionId,
  normalizeActionId,
} = require("./gesture-catalog");
const { applyTtsPronunciations } = require("./tts-pronunciations");

const BRACKET_PAUSE_BY_INNER = new Map([
  ["pause", "normal"],
  ["short pause", "short"],
  ["quiet pause", "quiet"],
  ["long pause", "long"],
]);

/** Unreal coarse mood / state routing (square brackets). Emitted as type "state". */
const BRACKET_STATE_BY_INNER = new Map([
  ["thinking", "thinking"],
  ["serious", "serious"],
  ["amused", "amused"],
  ["emphasis", "emphasis"],
  ["idle", "idle"],
  ["listening", "listening"],
  ["speaking", "speaking"],
  ["farewell", "farewell"],
  ["goodbye", "farewell"],
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

/**
 * Parse [gesture:Stem], [action:Stem], or bare Stem that matches the catalog.
 * @param {string} inner raw bracket inner (original casing)
 * @returns {{ value: string } | null}
 */
function parseNamedActionInner(inner) {
  const trimmed = String(inner || "").trim();
  if (!trimmed) {
    return null;
  }

  const prefixMatch = trimmed.match(/^(?:gesture|action)\s*:\s*(.+)$/i);
  const candidate = prefixMatch ? prefixMatch[1].trim() : trimmed;
  const stem = normalizeActionId(candidate);
  if (!stem || !isKnownActionId(stem)) {
    return null;
  }
  return { value: resolveCanonicalActionId(stem) };
}

/** True only for known Godfrey performer/pause/gesture markers (not arbitrary [brackets]). */
function isPerformanceCueMarker(raw) {
  if (!raw || typeof raw !== "string") {
    return false;
  }
  if (raw.startsWith("*") && raw.endsWith("*") && raw.length > 2) {
    return true;
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const innerRaw = raw.slice(1, -1);
    const inner = normalizeCueInner(innerRaw);
    if (BRACKET_PAUSE_BY_INNER.has(inner) || BRACKET_STATE_BY_INNER.has(inner)) {
      return true;
    }
    if (parseNamedActionInner(innerRaw)) {
      return true;
    }
    // Prefixed gesture/action markers are always treated as cues (stripped even if unknown).
    if (/^(?:gesture|action)\s*:/i.test(innerRaw.trim())) {
      return true;
    }
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

  return applyTtsPronunciations(
    out
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Index of the first character belonging to an unterminated cue, or -1. */
function unterminatedCueIndex(text) {
  let index = -1;

  const lastOpenBracket = text.lastIndexOf("[");
  if (lastOpenBracket !== -1 && text.indexOf("]", lastOpenBracket) === -1) {
    index = lastOpenBracket;
  }

  const asteriskCount = (text.match(/\*/g) || []).length;
  if (asteriskCount % 2 === 1) {
    const lastAsterisk = text.lastIndexOf("*");
    if (index === -1 || lastAsterisk < index) {
      index = lastAsterisk;
    }
  }

  return index;
}

/** Strip complete cues without trimming: streaming chunks must keep their edge spacing. */
function stripCompleteCues(text) {
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/\*[^*]*\*/g, " ").replace(/\[[^\]]*\]/g, " ");
  } while (out !== prev);
  return applyTtsPronunciations(out.replace(/[ \t]{2,}/g, " "));
}

/**
 * Incremental stripPerformanceCues for streamed LLM output. Text sitting inside
 * an unterminated cue is held back, so a marker is never split across two TTS
 * sends and half a `[gesture:...]` can never be spoken aloud.
 * @returns {{ push(chunk: string): string, flush(): string }}
 */
function createStreamingCueStripper() {
  let pending = "";

  return {
    push(chunk) {
      pending += String(chunk ?? "");
      const cut = unterminatedCueIndex(pending);
      const safe = cut === -1 ? pending : pending.slice(0, cut);
      pending = cut === -1 ? "" : pending.slice(cut);
      return stripCompleteCues(safe);
    },
    flush() {
      const rest = pending;
      pending = "";
      // Drop any cue the model left unterminated.
      return stripCompleteCues(rest).replace(/\[[^\]]*$/, "").replace(/\*[^*]*$/, "");
    },
  };
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
      const stateValue = BRACKET_STATE_BY_INNER.get(norm);
      if (stateValue !== undefined) {
        events.push({ type: "state", value: stateValue, raw, index });
        continue;
      }
      const named = parseNamedActionInner(inner);
      if (named) {
        events.push({ type: "action", value: named.value, raw, index });
        continue;
      }
      // Prefixed but unknown catalog id
      if (/^(?:gesture|action)\s*:/i.test(inner.trim())) {
        const after = inner.replace(/^(?:gesture|action)\s*:\s*/i, "").trim();
        events.push({
          type: "unknown",
          value: unknownMachineValue(after || inner),
          raw,
          index,
        });
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
    ["state", "thinking"],
    ["state", "serious"],
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

  const gestureFixture = `[thinking]
[gesture:TwoThumbsUp_01]
[action:SpeakingDescribeSize_01]
[Laughing_01]
Aye.`;
  const ev3 = parsePerformanceEvents(gestureFixture);
  const expected3 = [
    ["state", "thinking"],
    ["action", "TwoThumbsUp_01"],
    ["action", "SpeakingDescribeSize_01"],
    ["action", "Laughing_01"],
  ];
  let ok3 = ev3.length === expected3.length;
  for (let i = 0; i < expected3.length; i += 1) {
    if (!ev3[i] || ev3[i].type !== expected3[i][0] || ev3[i].value !== expected3[i][1]) {
      ok3 = false;
    }
  }
  const stripped3 = stripPerformanceCues(gestureFixture);
  if (!ok3 || /gesture|TwoThumbsUp|Laughing/.test(stripped3) || !/Aye/.test(stripped3)) {
    console.error("gesture parse/strip self-test FAILED", { ev3, stripped3, ok3 });
    process.exitCode = 1;
    return;
  }
  console.log("gesture catalog parse/strip self-test OK");

  const farewellFixture = `[farewell]\nSafe voyage.`;
  const ev4 = parsePerformanceEvents(farewellFixture);
  if (ev4.length !== 1 || ev4[0].type !== "state" || ev4[0].value !== "farewell") {
    console.error("farewell parse self-test FAILED", ev4);
    process.exitCode = 1;
    return;
  }
  console.log("farewell state parse self-test OK");

  // Streaming stripper: same input split at every awkward boundary must yield
  // the same spoken text as the batch stripper, and never leak a partial cue.
  const streamSource = `[thinking] Aye. *looks down* She went to pieces [gesture:Laughing_01] off Calgardup.`;
  const splitPoints = [1, 3, 5, 7, 11, 13, 17, 23, 29, 31, 37, 41];
  let streamOk = true;
  for (const size of splitPoints) {
    const stripper = createStreamingCueStripper();
    let out = "";
    for (let i = 0; i < streamSource.length; i += size) {
      out += stripper.push(streamSource.slice(i, i + size));
    }
    out += stripper.flush();
    if (/\[|\]|\*/.test(out)) {
      console.error("streaming stripper leaked a cue marker", { size, out });
      streamOk = false;
      break;
    }
    const normalise = (s) => s.replace(/\s+/g, " ").trim();
    if (normalise(out) !== normalise(stripPerformanceCues(streamSource))) {
      console.error("streaming stripper diverged from batch stripper", {
        size,
        streamed: normalise(out),
        batch: normalise(stripPerformanceCues(streamSource)),
      });
      streamOk = false;
      break;
    }
  }

  const truncated = createStreamingCueStripper();
  const truncatedOut = truncated.push("Aye. [gesture:Never") + truncated.flush();
  if (/\[|\]/.test(truncatedOut) || !/Aye\./.test(truncatedOut)) {
    console.error("streaming stripper mishandled an unterminated cue", { truncatedOut });
    streamOk = false;
  }

  if (!streamOk) {
    process.exitCode = 1;
    return;
  }
  console.log("streaming cue stripper self-test OK");
}

module.exports = {
  stripPerformanceCues,
  createStreamingCueStripper,
  parsePerformanceEvents,
  isPerformanceCueMarker,
  prepareExhibitionPerformanceText,
  // Back-compat alias used nowhere but kept for clarity in diffs
  BRACKET_PERFORMER_BY_INNER: BRACKET_STATE_BY_INNER,
};

if (require.main === module) {
  runSelfTest();
}
