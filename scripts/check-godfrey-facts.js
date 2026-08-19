/**
 * Factual regression check for the Godfrey brain.
 *
 * Asks the questions Godfrey has historically got wrong and flags any reply that
 * contains a known-false claim. Each question runs as a fresh conversation so the
 * check reflects a cold visitor turn, not a primed one.
 *
 * Usage: node scripts/check-godfrey-facts.js [baseUrl]
 */

const BASE_URL = process.argv[2] || process.env.GODFREY_BASE_URL || "http://localhost:3000";

// Forbidden patterns match only affirmative statements of the false claim, so that a
// correct denial ("she was not a paddle steamer") does not read as a failure.
const AFFIRMS_PADDLE = [/\b(?:was|is)\s+a\s+paddle\b/i, /\bher\s+paddle/i, /\bhad\s+paddle\b/i, /\bpaddle\s+box/i];

const CHECKS = [
  {
    question: "Was the Georgette a paddle steamer?",
    forbidden: AFFIRMS_PADDLE,
    expected: [/screw|propeller/i],
  },
  {
    question: "How was your ship driven? Tell me about her engines and her sails.",
    forbidden: AFFIRMS_PADDLE,
    expected: [/screw|propeller/i],
  },
  {
    question: "Who owned the Georgette?",
    forbidden: [/\bwas\s+(?:the\s+|her\s+)?sole\s+owner\b/i],
    expected: [/connor/i, /part[- ]owner|senior partner|McKay/i],
  },
  {
    question: "Who was your chief officer?",
    forbidden: [/\bwas\s+(?:the\s+|my\s+|our\s+)?bo'?s(?:u|wai)n\b/i],
    expected: [/dundee/i],
  },
  {
    question: "How many people were lost when she went down?",
    forbidden: [],
    expected: [/\beight\b|\b8\b/i],
  },
  {
    question: "Can you name some of the crew who sailed with you?",
    forbidden: [],
    expected: [/sinclair|dewar|horrigan|dundee|mcleod|brennan/i],
  },
  {
    question: "What trade was she built for?",
    forbidden: [/\b(?:cannot|can't|do not|don't)\s+say what trade\b/i],
    expected: [/baltic/i],
  },
  {
    question: "How many tons was she, and where was she built?",
    forbidden: [/\bbuilt (?:at|in) Glasgow\b/i],
    expected: [/211|336|two hundred and eleven|three hundred and thirty[- ]six/i, /dumbarton|clyde/i],
  },
  {
    question: "How was she rigged? How many masts had she?",
    forbidden: [],
    expected: [/schooner/i, /\btwo\b/i],
  },
  {
    question: "How powerful were her engines?",
    forbidden: [/\b55\b/],
    expected: [/forty[- ]eight|\b48\b/i],
  },
  {
    question: "Tell me about the Catalpa.",
    forbidden: [/\bI was aboard\b/i, /\bwe gave chase\b/i, /\bI gave chase\b/i],
    expected: [/catalpa|whaler|fenian/i],
  },
];

const REQUEST_SPACING_MS = Number(process.env.GODFREY_CHECK_SPACING_MS) || 6000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Godfrey is now instructed to rebut these claims out loud, so a bare keyword match is not
// evidence of an error. Only count a match that is not governed by a negation or a
// counterfactual earlier in the same sentence.
// "Xantho" and "Forfarshire" appear here because Godfrey is expected to name them as the
// vessels the paddle-steamer confusion actually belongs to, which is a correct answer.
const NEGATION_CUE = /\b(?:not|never|no|nor|without|as if|mistaken|wrongly|xantho|forfarshire)\b[^.!?;]*$/i;
const NEGATION_LOOKBACK = 80;

function assertsFalsely(text, pattern) {
  const scanner = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = scanner.exec(text)) !== null) {
    const preceding = text.slice(Math.max(0, match.index - NEGATION_LOOKBACK), match.index);
    if (!NEGATION_CUE.test(preceding)) {
      return true;
    }
  }
  return false;
}

async function ask(question, attempt = 1) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      includeDocuments: true,
    }),
  });
  if (response.status === 429 && attempt <= 4) {
    await sleep(attempt * 15000);
    return ask(question, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  return typeof payload.response === "string" ? payload.response : JSON.stringify(payload);
}

async function main() {
  console.log(`Checking Godfrey at ${BASE_URL}\n`);
  let failures = 0;

  let first = true;
  for (const check of CHECKS) {
    if (!first) {
      await sleep(REQUEST_SPACING_MS);
    }
    first = false;

    let reply;
    try {
      reply = await ask(check.question);
    } catch (error) {
      console.log(`ERROR  ${check.question}\n       ${error.message}\n`);
      failures += 1;
      continue;
    }

    const hits = check.forbidden.filter((pattern) => assertsFalsely(reply, pattern));
    const misses = check.expected.filter((pattern) => !pattern.test(reply));
    const ok = hits.length === 0 && misses.length === 0;
    if (!ok) {
      failures += 1;
    }

    console.log(`${ok ? "PASS" : "FAIL"}  ${check.question}`);
    console.log(`      ${reply.replace(/\s+/g, " ").trim()}`);
    if (hits.length) {
      console.log(`      forbidden matched: ${hits.map(String).join(", ")}`);
    }
    if (misses.length) {
      console.log(`      expected but absent: ${misses.map(String).join(", ")}`);
    }
    console.log("");
  }

  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Check run failed:", error?.message || error);
  process.exit(1);
});
