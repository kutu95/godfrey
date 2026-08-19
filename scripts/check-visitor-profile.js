/**
 * Self-check for visitor profile extraction.
 *
 * The heuristics decide whether Godfrey calls someone by the wrong name or asks a question he
 * has already asked, both of which read as a broken figure in the gallery. Run after editing
 * lib/visitor-profile.js:
 *
 *   node scripts/check-visitor-profile.js
 */

const assert = require("node:assert");

const {
  resolveVisitorSessionKey,
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
} = require("../lib/visitor-profile");
const { applyTtsPronunciations } = require("../lib/tts-pronunciations");

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

console.log("Names given explicitly");
for (const [text, expected] of [
  ["My name is Sarah.", "Sarah"],
  ["my name's tom", "Tom"],
  ["They call me Meg, sir.", "Meg"],
  ["Call me Meg.", "Meg"],
  ["I'm Ravi.", "Ravi"],
  ["I am called Elizabeth Hart", "Elizabeth Hart"],
]) {
  check(`${JSON.stringify(text)} -> ${expected}`, () => {
    assert.strictEqual(extractName(text, false), expected);
  });
}

console.log("Things that are not names");
for (const text of [
  "I'm from Perth.",
  "I'm tired of standing.",
  "I am not sure what to ask.",
  "I'm just looking around.",
  "I'm interested in the wreck.",
  "What is your name?",
  "I am 42 years old.",
]) {
  check(`${JSON.stringify(text)} -> null`, () => {
    assert.strictEqual(extractName(text, false), null);
  });
}

console.log("Bare answers");
check('"Sarah" after being asked', () => {
  assert.strictEqual(extractName("Sarah", true), "Sarah");
});
check('a single word offered unprompted is taken as a name', () => {
  assert.strictEqual(extractName("Priya", false), "Priya");
});
check("two words unprompted are not", () => {
  assert.strictEqual(extractName("Priya Nair", false), null);
});
check("two words are, once he has asked", () => {
  assert.strictEqual(extractName("Priya Nair", true), "Priya Nair");
});
check('"yes" is never a name', () => {
  assert.strictEqual(extractName("yes", true), null);
});
check('"Pardon?" is never a name', () => {
  assert.strictEqual(extractName("Pardon?", true), null);
});
check('"Sorry" is never a name', () => {
  assert.strictEqual(extractName("Sorry", false), null);
});
check("a whole sentence is not a bare name", () => {
  assert.strictEqual(extractName("tell me about the ship", true), null);
});

console.log("Experience of the sea");
for (const [text, expected] of [
  ["I served twelve years in the merchant navy.", "experienced"],
  ["I'm a fisherman out of Albany.", "experienced"],
  ["I've been on the Rottnest ferry a few times.", "passenger"],
  ["I got seasick on a cruise once.", "passenger"],
  ["I've never been to sea.", "none"],
  ["No, I'm not a sailor.", "none"],
  ["What was the weather like?", null],
]) {
  check(`${JSON.stringify(text)} -> ${expected}`, () => {
    assert.strictEqual(extractSeaExperience(text), expected);
  });
}

console.log("Local knowledge");
check("Fremantle and Margaret River are both picked up", () => {
  const places = extractPlaces("I live in Fremantle but we drove down past Margaret River.");
  assert.deepStrictEqual(places.sort(), ["fremantle", "margaret river"]);
});
check("no place mentioned", () => {
  assert.deepStrictEqual(extractPlaces("How many people were aboard?"), []);
});

console.log("Verdicts");
for (const [text, expected] of [
  ["I think you did all you could.", "sympathetic"],
  ["You should have turned back.", "critical"],
  ["Honestly it's hard to say.", "undecided"],
  ["Tell me more about the lifeboat.", null],
]) {
  check(`${JSON.stringify(text)} -> ${expected}`, () => {
    assert.strictEqual(extractVerdict(text), expected);
  });
}

console.log("Reading back what Godfrey asked");
check("a name question is recognised", () => {
  assert.deepStrictEqual(detectAssistantQuestions("[thinking] Godfrey. And your name?"), ["name"]);
});
check("a family-name question is recognised", () => {
  assert.deepStrictEqual(detectAssistantQuestions("Marcia. And your family name?"), ["surname"]);
});
check("a sea question is recognised", () => {
  assert.deepStrictEqual(detectAssistantQuestions("Have you ever been to sea yourself?"), ["sea"]);
});
check("a plain answer asks nothing", () => {
  assert.deepStrictEqual(detectAssistantQuestions("She was 211 tons net."), []);
});

console.log("Encounter stages");
for (const [turn, expected] of [
  [1, "opening"],
  [2, "early"],
  [4, "early"],
  [5, "middle"],
  [9, "middle"],
  [10, "late"],
]) {
  check(`turn ${turn} -> ${expected}`, () => {
    assert.strictEqual(encounterStage(turn), expected);
  });
}

console.log("A whole encounter");
const key = resolveVisitorSessionKey({ explicitId: "selftest-encounter" });
resetVisitorProfile(key);

check("turn 1 knows nothing, and pushes him to introduce himself", () => {
  const block = buildVisitorContextBlock(ingestVisitorTurn(key, "Hello. What happened to your ship?"));
  assert.match(block, /exchange 1 of the encounter\. Stage: opening/);
  assert.doesNotMatch(block, /Name:/);
  assert.match(block, /ask theirs/);
});

check("asking the name is remembered", () => {
  ingestAssistantTurn(key, "She was lost on the first of December. Godfrey is my name. And yours?", {
    visitorText: "Hello. What happened to your ship?",
  });
  const block = buildVisitorContextBlockForSession(key);
  assert.match(block, /waiting on the answer/);
});

check("the bare answer is taken as the name, and he is not pushed to ask again at once", () => {
  const block = buildVisitorContextBlock(ingestVisitorTurn(key, "Priya"));
  assert.match(block, /Name: Priya/);
  assert.match(block, /do not ask again: their name/);
  assert.doesNotMatch(block, /Worth asking/);
});

check("a turn later he is pointed at the next thing worth knowing", () => {
  ingestAssistantTurn(key, "Priya. A good name.", { visitorText: "Priya" });
  const block = buildVisitorContextBlock(ingestVisitorTurn(key, "What was the weather like?"));
  assert.match(block, /have been to sea\. Worth asking/);
});

check("sea experience is picked up mid-encounter and shapes the note", () => {
  ingestAssistantTurn(key, "Priya. Have you been to sea yourself?", { visitorText: "Priya" });
  const block = buildVisitorContextBlock(
    ingestVisitorTurn(key, "Only as a passenger, on the ferry to Rottnest.")
  );
  assert.match(block, /The sea: has travelled by sea but never worked it/);
  assert.match(block, /Knows: rottnest/);
  assert.match(block, /do not ask again: their name; whether they have been to sea/);
});

check("turn one survives the arrival of a log session id", () => {
  const anonymous = resolveVisitorSessionKey({ clientIp: "203.0.113.9" });
  resetVisitorProfile(anonymous);
  ingestVisitorTurn(anonymous, "My name is Tom.");
  const identified = resolveVisitorSessionKey({
    explicitId: "session-late-arrival",
    clientIp: "203.0.113.9",
  });
  const block = buildVisitorContextBlockForSession(identified);
  assert.match(block, /Name: Tom/);
  assert.strictEqual(buildVisitorContextBlockForSession(anonymous), "");
  resetVisitorProfile(identified);
});

console.log("Topics already told (no chat history on the exhibition path)");
check("a full death roster is detected", () => {
  const topics = detectToldTopics(
    "Mrs Davis and her boy Alexander, Mrs Elizabeth Hauxwell with John, Frances and Isabella, Ada Dixon, and Herbert Osborne aboard."
  );
  assert.deepStrictEqual(topics, ["named_the_dead"]);
});
check("a passing mention of one name is not a roster", () => {
  assert.deepStrictEqual(detectToldTopics("I think of Herbert often."), []);
});
check("after naming the dead, the next prompt forbids re-listing them", () => {
  const topicKey = resolveVisitorSessionKey({ explicitId: "selftest-dead-list" });
  resetVisitorProfile(topicKey);
  ingestVisitorTurn(topicKey, "Who did not live?");
  ingestAssistantTurn(
    topicKey,
    "Mrs Davis and Alexander, Mrs Hauxwell, John, Frances, Isabella, Ada Dixon, and Herbert Osborne.",
    { visitorText: "Who did not live?" }
  );
  const block = buildVisitorContextBlock(ingestVisitorTurn(topicKey, "How do you feel about the deaths?"));
  assert.match(block, /Already told this encounter — do not recite again: the names of those who died/);
  resetVisitorProfile(topicKey);
});

check("a farewell clears the encounter for the next visitor", () => {
  ingestAssistantTurn(key, "[gesture:FarewellWave_01] Go well.", { visitorText: "Thanks, goodbye." });
  assert.strictEqual(buildVisitorContextBlockForSession(key), "");
  const block = buildVisitorContextBlock(ingestVisitorTurn(key, "Hello there."));
  assert.match(block, /exchange 1 of the encounter/);
  assert.doesNotMatch(block, /Name: Priya/);
});
resetVisitorProfile(key);

console.log("Notable visitor watchlist (Marcia van Zeller)");
const marciaKey = resolveVisitorSessionKey({ explicitId: "selftest-marcia" });
resetVisitorProfile(marciaKey);

check("asking about her is not self-identification", () => {
  assert.strictEqual(looksLikeSelfIdentification("Do you know Marcia van Zeller?", false), false);
});
check("a question about her does not confirm the watchlist", () => {
  const block = buildVisitorContextBlock(ingestVisitorTurn(marciaKey, "Do you know Marcia van Zeller?"));
  assert.doesNotMatch(block, /Marcia van Zeller/);
  assert.doesNotMatch(block, /family name/);
  assert.strictEqual(peekPendingNotableRecognition(marciaKey), null);
  resetVisitorProfile(marciaKey);
});
check("a full self-introduction confirms her at once", () => {
  ingestVisitorTurn(marciaKey, "My name is Marcia van Zeller.");
  const pending = peekPendingNotableRecognition(marciaKey);
  assert.ok(pending);
  assert.strictEqual(pending.id, "marcia-van-zeller");
  const block = buildVisitorContextBlockForSession(marciaKey);
  assert.match(block, /Name: Marcia van Zeller/);
  assert.match(block, /keeping the record of that night/);
  resetVisitorProfile(marciaKey);
});
check("Marcia alone asks for the family name, and does not recognise yet", () => {
  ingestAssistantTurn(marciaKey, "Godfrey. And your name?", { visitorText: "Hello." });
  const block = buildVisitorContextBlock(ingestVisitorTurn(marciaKey, "Marcia"));
  assert.match(block, /Name: Marcia/);
  assert.match(block, /family name/);
  assert.doesNotMatch(block, /You recognised her/);
  assert.strictEqual(peekPendingNotableRecognition(marciaKey), null);
});
check("a matching surname then unlocks the one-shot recognition", () => {
  ingestAssistantTurn(marciaKey, "Marcia. And your family name?", { visitorText: "Marcia" });
  ingestVisitorTurn(marciaKey, "Van Zeller");
  const pending = peekPendingNotableRecognition(marciaKey);
  assert.ok(pending);
  assert.strictEqual(pending.occasionId, "marcia-van-zeller");
  const { getOccasionScript } = require("../lib/occasion-scripts");
  assert.ok(getOccasionScript("marcia-van-zeller")?.text.includes("keeping the record"));
  markNotableRecognitionDelivered(marciaKey);
  assert.strictEqual(peekPendingNotableRecognition(marciaKey), null);
  const block = buildVisitorContextBlockForSession(marciaKey);
  assert.match(block, /already spoken your thanks/);
  assert.doesNotMatch(block, /This is the turn to recognise her/);
  resetVisitorProfile(marciaKey);
});
check("STT aliases still confirm (Marsha / vanzeller)", () => {
  ingestVisitorTurn(marciaKey, "I'm Marsha Vanzeller");
  assert.strictEqual(peekPendingNotableRecognition(marciaKey)?.id, "marcia-van-zeller");
  resetVisitorProfile(marciaKey);
});
check("STT 'Vanzilla' after Marcia still confirms", () => {
  ingestAssistantTurn(marciaKey, "And your family name?", { visitorText: "Marcia" });
  ingestVisitorTurn(marciaKey, "Marcia");
  ingestVisitorTurn(marciaKey, "Vanzilla");
  assert.strictEqual(peekPendingNotableRecognition(marciaKey)?.id, "marcia-van-zeller");
  resetVisitorProfile(marciaKey);
});
check("loopback IPv4 and IPv6 map to the same encounter", () => {
  const fromV6 = resolveVisitorSessionKey({ clientIp: "::1" });
  const fromMapped = resolveVisitorSessionKey({ clientIp: "::ffff:127.0.0.1" });
  assert.strictEqual(fromV6, fromMapped);
  assert.strictEqual(fromV6, resolveVisitorSessionKey({ clientIp: "127.0.0.1" }));
});
check("a different surname after Marcia is not a recognition", () => {
  ingestAssistantTurn(marciaKey, "And your family name?", { visitorText: "Marcia" });
  ingestVisitorTurn(marciaKey, "Marcia");
  ingestVisitorTurn(marciaKey, "Smith");
  assert.strictEqual(peekPendingNotableRecognition(marciaKey), null);
  const block = buildVisitorContextBlockForSession(marciaKey);
  assert.match(block, /Name: Marcia Smith/);
  assert.doesNotMatch(block, /keeping the record/);
  resetVisitorProfile(marciaKey);
});
check("explicit three-word particle names extract", () => {
  assert.strictEqual(extractName("My name is Marcia van Zeller.", false), "Marcia Van Zeller");
});
check("a surname offer after being asked", () => {
  assert.strictEqual(extractSurnameOffer("Van Zeller", true), "Van Zeller");
});
check("Marcia is respelt for the voice as Mar-see-ah", () => {
  assert.match(applyTtsPronunciations("Well, Marcia, I am John."), /Mar-see-ah/);
  assert.doesNotMatch(applyTtsPronunciations("Well, Marcia, I am John."), /\bMarcia\b/);
});
check("Vasse is respelt for the voice as Vass", () => {
  assert.strictEqual(applyTtsPronunciations("We left the Vasse at half past nine."), "We left the Vass at half past nine.");
  assert.doesNotMatch(applyTtsPronunciations("Called at the Vasse, then Adelaide."), /\bVasse\b/);
});

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All visitor profile checks passed.");
