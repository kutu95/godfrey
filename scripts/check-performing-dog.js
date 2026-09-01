/**
 * Self-check: stunt / performing-dog requests vs biographical questions.
 *
 *   node scripts/check-performing-dog.js
 */

const assert = require("node:assert");
const {
  detectPerformingDogRequest,
  appendPerformingDogInstruction,
} = require("../lib/performing-dog");

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

console.log("Stunt requests");
for (const text of [
  "clap your hands Godfrey",
  "clapp your hands Godfrey",
  "Clap your hands.",
  "I want to see you clap your hands.",
  "Can you clap your hands?",
  "jump up and down",
  "Jump up and down, Godfrey.",
  "dance godfrey",
  "Dance, Godfrey.",
  "Can you dance?",
  "do a little dance",
  "spin around",
  "do a trick",
  "show me a trick",
]) {
  check(`${JSON.stringify(text)} is a stunt`, () => {
    assert.strictEqual(detectPerformingDogRequest(text), true);
  });
}

console.log("Not a stunt");
for (const text of [
  "Did you dance at the soirees?",
  "Did you ever dance?",
  "What happened to the ship?",
  "Would you have turned back?",
  "Tell me about Hannah.",
  "goodbye",
]) {
  check(`${JSON.stringify(text)} is not a stunt`, () => {
    assert.strictEqual(detectPerformingDogRequest(text), false);
  });
}

check("instruction names the performing dog refusal", () => {
  const block = appendPerformingDogInstruction("");
  assert.match(block, /performing dog/i);
  assert.match(block, /Do not ask a question/);
  assert.match(block, /Do not treat this as a goodbye/);
});

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All performing-dog checks passed.");
