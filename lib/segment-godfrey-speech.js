/**
 * Sentence/clause segmentation for Unreal exhibition TTS (short ACE-friendly clips).
 */

const {
  parsePerformanceEvents,
  stripPerformanceCues,
  isPerformanceCueMarker,
  prepareExhibitionPerformanceText,
} = require("./performance-text");

/** ElevenLabs + Victorian delivery runs slower than raw WPM estimates. */
const WORDS_PER_SECOND = 1.8;
/** Target ~2–4s per segment */
const TARGET_MAX_WORDS = 5;
/** Hard cap ~5s spoken (~9 words at 1.8 w/s) */
const HARD_MAX_WORDS = 9;

const MARKER_PATTERN = /(\[[^\]]*\]|\*[^*]+\*)/g;

const ABBREV_END = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|Capt|Col|Rev|St|Hon|No|approx|dept)\.\s*$/i;

function countWords(text) {
  const t = String(text || "").trim();
  if (!t) {
    return 0;
  }
  return t.split(/\s+/).filter(Boolean).length;
}

function estimateDurationMs(spokenText) {
  const words = countWords(spokenText);
  if (words === 0) {
    return 0;
  }
  return Math.round((words / WORDS_PER_SECOND) * 1000);
}

function splitIntoSentences(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  const rough = normalized.split(/(?<=[.!?…])\s+/);
  const merged = [];
  for (const part of rough) {
    const chunk = part.trim();
    if (!chunk) {
      continue;
    }
    if (merged.length > 0 && ABBREV_END.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

function splitIntoClauses(sentence) {
  const s = String(sentence || "").trim();
  if (!s) {
    return [];
  }
  if (countWords(s) <= HARD_MAX_WORDS) {
    return [s];
  }

  const parts = s.split(/\s*;\s+|\s+—\s+|\s+–\s+/);
  if (parts.length > 1) {
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  const commaParts = s.split(/,\s+(?=(?:and|but|yet|so|for|nor|or|which|who|when|where|though|although)\s)/i);
  if (commaParts.length > 1) {
    return commaParts.map((p) => p.trim()).filter(Boolean);
  }

  return splitByWordChunks(s, HARD_MAX_WORDS);
}

function splitByWordChunks(text, maxWords) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) {
    return [words.join(" ")];
  }
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

function tokenizePerformanceText(performanceText) {
  const text = String(performanceText || "");
  const units = [];
  let lastIndex = 0;
  MARKER_PATTERN.lastIndex = 0;
  for (const m of text.matchAll(MARKER_PATTERN)) {
    if (m.index > lastIndex) {
      const chunk = text.slice(lastIndex, m.index);
      if (chunk.trim()) {
        units.push({ type: "text", value: chunk });
      }
    }
    if (isPerformanceCueMarker(m[0])) {
      units.push({ type: "cue", raw: m[0] });
    } else {
      units.push({ type: "text", value: m[0] });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex);
    if (chunk.trim()) {
      units.push({ type: "text", value: chunk });
    }
  }
  return units;
}

function buildPerformanceSegment(cueRaws, spokenParts) {
  const lines = [];
  for (const raw of cueRaws) {
    lines.push(raw);
  }
  const spoken = spokenParts.join(" ").replace(/\s+/g, " ").trim();
  if (spoken) {
    lines.push(spoken);
  }
  return lines.join("\n").trim();
}

function makeSegment(cueRaws, spokenParts) {
  const performanceText = buildPerformanceSegment(cueRaws, spokenParts);
  const spokenText = stripPerformanceCues(performanceText).trim();
  if (!spokenText) {
    return null;
  }
  return {
    performanceText,
    spokenText,
    performanceEvents: parsePerformanceEvents(performanceText),
    estimatedDurationMs: estimateDurationMs(spokenText),
  };
}

/**
 * @param {string} performanceText Full assistant reply with optional cues.
 * @returns {Array<{ performanceText: string, spokenText: string, performanceEvents: ReturnType<typeof parsePerformanceEvents>, estimatedDurationMs: number }>}
 */
function segmentGodfreySpeech(performanceText) {
  const text = prepareExhibitionPerformanceText(performanceText);
  if (!text) {
    return [];
  }

  const units = tokenizePerformanceText(text);
  const expanded = [];
  for (const u of units) {
    if (u.type === "cue") {
      expanded.push(u);
    } else {
      for (const sentence of splitIntoSentences(u.value)) {
        for (const clause of splitIntoClauses(sentence)) {
          for (const chunk of splitByWordChunks(clause, HARD_MAX_WORDS)) {
            if (chunk.trim()) {
              expanded.push({ type: "text", value: chunk.trim() });
            }
          }
        }
      }
    }
  }

  const rawSegments = [];
  let pendingCues = [];
  let bufText = [];

  function flushSegment() {
    if (!bufText.length) {
      return;
    }
    const seg = makeSegment(pendingCues, bufText);
    pendingCues = [];
    bufText = [];
    if (seg) {
      rawSegments.push(seg);
    }
  }

  for (const u of expanded) {
    if (u.type === "cue") {
      pendingCues.push(u.raw);
      continue;
    }

    const chunks = splitByWordChunks(u.value, HARD_MAX_WORDS);
    for (const chunk of chunks) {
      const nextWords = countWords(chunk);
      const bufWords = countWords(bufText.join(" "));

      if (bufWords > 0 && bufWords + nextWords > HARD_MAX_WORDS) {
        flushSegment();
      } else if (bufWords > 0 && bufWords + nextWords > TARGET_MAX_WORDS) {
        flushSegment();
      }

      bufText.push(chunk);
    }
  }
  flushSegment();

  if (pendingCues.length > 0 && rawSegments.length > 0) {
    const last = rawSegments[rawSegments.length - 1];
    const mergedPerf = `${pendingCues.join("\n")}\n${last.performanceText}`.trim();
    rawSegments[rawSegments.length - 1] = {
      performanceText: mergedPerf,
      spokenText: stripPerformanceCues(mergedPerf).trim(),
      performanceEvents: parsePerformanceEvents(mergedPerf),
      estimatedDurationMs: estimateDurationMs(stripPerformanceCues(mergedPerf)),
    };
  }

  if (rawSegments.length === 0 && text) {
    const fallback = makeSegment([], [stripPerformanceCues(text)]);
    return fallback ? [fallback] : [];
  }

  return rawSegments;
}

function runSelfTest() {
  const single = "We ran her ashore at Redgate Beach.";
  const s1 = segmentGodfreySpeech(single);
  if (s1.length !== 1 || !s1[0].spokenText.includes("Redgate")) {
    console.error("single sentence self-test FAILED", s1);
    process.exitCode = 1;
    return;
  }

  const withAdminSuffix = `${single}\n\n[Reply limited to 80 words by admin setting.]`;
  const sAdmin = segmentGodfreySpeech(withAdminSuffix);
  if (sAdmin.some((s) => s.performanceEvents.some((e) => e.type === "unknown"))) {
    console.error("admin suffix should not become performance cue", sAdmin);
    process.exitCode = 1;
    return;
  }

  const multi = `[thinking]
*looks down*
We ran her ashore at Redgate Beach. Seven souls were lost that night. I have replayed those hours many times since. The inquiry found neglect where I believe courage was shown. Dundee bore blame I still consider just. Yet the board saw otherwise, and my certificate was suspended.`;
  const parts = segmentGodfreySpeech(multi);
  if (parts.length < 3) {
    console.error("multi sentence self-test FAILED: expected >=3 segments", parts.length);
    process.exitCode = 1;
    return;
  }
  for (const p of parts) {
    const w = countWords(p.spokenText);
    if (w > HARD_MAX_WORDS) {
      console.error("segment exceeds HARD_MAX_WORDS", w, p.spokenText.slice(0, 80));
      process.exitCode = 1;
      return;
    }
    if (!p.spokenText.trim()) {
      console.error("cue-only segment should not exist", p);
      process.exitCode = 1;
      return;
    }
  }
  if (!parts[0].performanceEvents.some((e) => e.type === "performer" && e.value === "thinking")) {
    console.error("first segment missing thinking cue", parts[0].performanceEvents);
    process.exitCode = 1;
    return;
  }
  console.log("segmentGodfreySpeech self-test OK", { segmentCount: parts.length });
}

module.exports = {
  segmentGodfreySpeech,
  splitIntoSentences,
  estimateDurationMs,
  prepareExhibitionPerformanceText,
  TARGET_MAX_WORDS,
  HARD_MAX_WORDS,
};

if (require.main === module) {
  runSelfTest();
}
