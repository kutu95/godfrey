/**
 * Self-check for visitor farewell detection (exhibition goodbye → Unreal latch).
 *
 *   node scripts/check-conversation-end.js
 */

const assert = require("node:assert");
const {
  detectVisitorFarewellIntent,
  evaluateConversationEnd,
  appendVisitorLeavingInstruction,
} = require("../lib/conversation-end");

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

console.log("Visitor farewell phrases");
for (const text of [
  "goodbye",
  "Goodbye.",
  "I've got to go now, goodbye",
  "I've got to go now",
  "I have to go",
  "I must be off",
  "that's all",
  "thanks for your time",
  "see you",
  "see you later",
  "hope to see you again",
  "bye",
]) {
  check(`${JSON.stringify(text)} is a farewell`, () => {
    assert.strictEqual(detectVisitorFarewellIntent(text), true);
  });
}

console.log("Not leaving");
for (const text of [
  "Did you ever say goodbye to her?",
  "Tell me about the board.",
  "Hello, Godfrey.",
  "What happened to the ship?",
  "It's good to see you back, Godfrey.",
  "good to see you",
  "nice to see you",
  "great to see you",
  "It's so good to see you",
  "I want to see you clap your hands.",
  "I want to see you clap your hands",
  "Can you clap your hands?",
  "Let me see you do that",
]) {
  check(`${JSON.stringify(text)} is not a farewell`, () => {
    assert.strictEqual(detectVisitorFarewellIntent(text), false);
  });
}

check("evaluateConversationEnd uses the visitor phrase even without a reply cue", () => {
  const result = evaluateConversationEnd({
    visitorText: "I've got to go now, goodbye",
    performanceEvents: [],
  });
  assert.strictEqual(result.conversationEnd, true);
  assert.strictEqual(result.conversationEndSource, "visitor_phrase");
});

check("leaving instruction asks for [farewell] and no further questions", () => {
  const block = appendVisitorLeavingInstruction("");
  assert.match(block, /\[farewell\]/);
  assert.match(block, /Do not ask a question/);
});

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All conversation-end checks passed.");
