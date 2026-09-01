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
  extractAddressedName,
  idleResetMs,
  extractSurnameOffer,
  extractSeaExperience,
  extractPlaces,
  extractVerdict,
  detectAssistantQuestions,
  detectToldTopics,
  looksLikeSelfIdentification,
  shouldIncludeDocumentsForTurn,
  getRecentConversationMessages,
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
  ["Hi, you're talking to Uli.", "Uli"],
  ["You're speaking with Ollie.", "Ollie"],
  ["This is Priya speaking.", "Priya"],
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
  "Were you talking to Hannah?",
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
  ["I've done some sailing.", "passenger"],
  ["I sail a bit myself.", "passenger"],
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
  ["I'm on your side.", "sympathetic"],
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
check("a welcome 'who is it I have before me' is a name question", () => {
  assert.deepStrictEqual(
    detectAssistantQuestions("Welcome to Fremantle harbour. Who is it I have before me?"),
    ["name"]
  );
});
check("a family-name question is recognised", () => {
  assert.deepStrictEqual(detectAssistantQuestions("Marcia. And your family name?"), ["surname"]);
});
check("a sea question is recognised", () => {
  assert.deepStrictEqual(detectAssistantQuestions("Have you ever been to sea yourself?"), ["sea"]);
});
check("an ally question is recognised as a verdict ask", () => {
  assert.deepStrictEqual(
    detectAssistantQuestions("You know what it is like. Will you take my side?"),
    ["verdict"]
  );
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
  assert.match(block, /The sea: has sailed themselves/);
  assert.match(block, /Ask them plainly to be on your side/);
  assert.match(block, /Knows: rottnest/);
  assert.match(block, /do not ask again: their name; whether they have been to sea/);
  assert.match(block, /They have been on the water/);
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

console.log("Topics already told");
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
check("Vasse is respelt for the voice as Vas", () => {
  assert.strictEqual(applyTtsPronunciations("We left the Vasse at half past nine."), "We left the Vas at half past nine.");
  assert.doesNotMatch(applyTtsPronunciations("Called at the Vasse, then Adelaide."), /\bVasse\b/);
});
check("Jarrah is respelt for the voice as Jar-uh", () => {
  assert.strictEqual(applyTtsPronunciations("Loaded jarrah at Bunbury."), "Loaded Jar-uh at Bunbury.");
  assert.doesNotMatch(applyTtsPronunciations("The Jarrah was stowed below."), /\bJarrah\b/);
});
check("Naturaliste is respelt for the voice as Naturalist", () => {
  assert.strictEqual(
    applyTtsPronunciations("Fifteen miles south of Cape Naturaliste."),
    "Fifteen miles south of Cape Naturalist."
  );
  assert.doesNotMatch(applyTtsPronunciations("Rounding Cape Naturaliste."), /\bNaturaliste\b/);
});

console.log("Notable visitor watchlist (Stef Koens)");
const stefKey = resolveVisitorSessionKey({ explicitId: "selftest-stef" });
resetVisitorProfile(stefKey);

check("asking about her is not self-identification", () => {
  assert.strictEqual(looksLikeSelfIdentification("Do you know Stef Koens?", false), false);
});
check("a question about her does not confirm the watchlist", () => {
  const block = buildVisitorContextBlock(ingestVisitorTurn(stefKey, "Do you know Stef Koens?"));
  assert.doesNotMatch(block, /Stef Koens/);
  assert.doesNotMatch(block, /sunken ships/);
  assert.strictEqual(peekPendingNotableRecognition(stefKey), null);
  resetVisitorProfile(stefKey);
});
check("a full self-introduction confirms her at once", () => {
  ingestVisitorTurn(stefKey, "My name is Stefanie Koens.");
  const pending = peekPendingNotableRecognition(stefKey);
  assert.ok(pending);
  assert.strictEqual(pending.id, "stef-koens");
  const block = buildVisitorContextBlockForSession(stefKey);
  assert.match(block, /Name: Stef Koens/);
  assert.match(block, /write stories about sunken ships/);
  assert.match(block, /Address them as Stef/);
  resetVisitorProfile(stefKey);
});
check("Stef alone asks for the family name, and does not recognise yet", () => {
  ingestAssistantTurn(stefKey, "Godfrey. And your name?", { visitorText: "Hello." });
  const block = buildVisitorContextBlock(ingestVisitorTurn(stefKey, "Stef"));
  assert.match(block, /Name: Stef/);
  assert.match(block, /family name/);
  assert.doesNotMatch(block, /You recognised her/);
  assert.strictEqual(peekPendingNotableRecognition(stefKey), null);
});
check("a matching surname then unlocks the one-shot recognition", () => {
  ingestAssistantTurn(stefKey, "Stef. And your family name?", { visitorText: "Stef" });
  ingestVisitorTurn(stefKey, "Koens");
  const pending = peekPendingNotableRecognition(stefKey);
  assert.ok(pending);
  assert.strictEqual(pending.occasionId, "stef-koens");
  const { getOccasionScript } = require("../lib/occasion-scripts");
  assert.ok(getOccasionScript("stef-koens")?.text.includes("sunken ships"));
  markNotableRecognitionDelivered(stefKey);
  assert.strictEqual(peekPendingNotableRecognition(stefKey), null);
  const block = buildVisitorContextBlockForSession(stefKey);
  assert.match(block, /already spoken your note/);
  assert.doesNotMatch(block, /This is the turn to recognise her/);
  resetVisitorProfile(stefKey);
});
check("STT aliases still confirm (Stephanie / Coens)", () => {
  ingestVisitorTurn(stefKey, "I'm Stephanie Coens");
  assert.strictEqual(peekPendingNotableRecognition(stefKey)?.id, "stef-koens");
  resetVisitorProfile(stefKey);
});
check("Koens is respelt for the voice as Koons", () => {
  assert.match(applyTtsPronunciations("Well, Stef Koens, I am glad."), /Koons/);
  assert.doesNotMatch(applyTtsPronunciations("Well, Stef Koens, I am glad."), /\bKoens\b/);
});
check("a different surname after Stef is not a recognition", () => {
  ingestAssistantTurn(stefKey, "And your family name?", { visitorText: "Stef" });
  ingestVisitorTurn(stefKey, "Stef");
  ingestVisitorTurn(stefKey, "Smith");
  assert.strictEqual(peekPendingNotableRecognition(stefKey), null);
  const block = buildVisitorContextBlockForSession(stefKey);
  assert.match(block, /Name: Stef Smith/);
  assert.doesNotMatch(block, /sunken ships/);
  resetVisitorProfile(stefKey);
});

console.log("John is not a watchlist given name");
const johnKey = resolveVisitorSessionKey({ explicitId: "selftest-john-not-watchlist" });
resetVisitorProfile(johnKey);
check("a plain John does not prompt for a watchlist surname", () => {
  ingestAssistantTurn(johnKey, "Godfrey. And your name?", { visitorText: "Hello." });
  const block = buildVisitorContextBlock(ingestVisitorTurn(johnKey, "John"));
  assert.match(block, /Name: John/);
  assert.doesNotMatch(block, /family name/);
  assert.doesNotMatch(block, /Pancake/);
  assert.strictEqual(peekPendingNotableRecognition(johnKey), null);
  resetVisitorProfile(johnKey);
});
check("John Sullivan does not auto-recognise", () => {
  ingestVisitorTurn(johnKey, "My name is John Sullivan.");
  assert.strictEqual(peekPendingNotableRecognition(johnKey), null);
  const block = buildVisitorContextBlockForSession(johnKey);
  assert.doesNotMatch(block, /never been invited/);
  resetVisitorProfile(johnKey);
});

console.log("Recent conversation window");
const historyKey = resolveVisitorSessionKey({ explicitId: "selftest-recent-turns" });
resetVisitorProfile(historyKey);
const welcomePrompt =
  "(A visitor has just approached and stands before you. Welcome them warmly in one or two short sentences, in character. Do not wait for them to speak first.)";

check("a spoken 'you're talking to' name is kept, and the welcome ask is not repeated", () => {
  ingestVisitorTurn(historyKey, welcomePrompt);
  ingestAssistantTurn(historyKey, "Welcome to Fremantle harbour. Who is it I have before me?", {
    visitorText: welcomePrompt,
  });
  const named = buildVisitorContextBlock(ingestVisitorTurn(historyKey, "Hi, you're talking to Uli."));
  assert.match(named, /Name: Uli/);
  assert.match(named, /do not ask again: their name/);
  assert.match(named, /Never ask who you are speaking with/);
  assert.doesNotMatch(named, /You do not know their name/);
});

check("the exhibition path gets prior turns, with the welcome instruction stored as a stub", () => {
  const messages = getRecentConversationMessages(historyKey, "Hi, you're talking to Uli.");
  assert.strictEqual(messages[0].role, "user");
  assert.strictEqual(messages[0].content, "[A visitor has just walked up.]");
  assert.strictEqual(messages[1].role, "assistant");
  assert.match(messages[1].content, /Who is it I have before me/);
  assert.strictEqual(messages[messages.length - 1].role, "user");
  assert.strictEqual(messages[messages.length - 1].content, "Hi, you're talking to Uli.");
});

check("the live welcome request still sends the real instruction, not the stub", () => {
  const liveKey = resolveVisitorSessionKey({ explicitId: "selftest-live-welcome" });
  resetVisitorProfile(liveKey);
  ingestVisitorTurn(liveKey, welcomePrompt);
  const live = getRecentConversationMessages(liveKey, welcomePrompt);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].content, welcomePrompt);
  resetVisitorProfile(liveKey);
});

check("the window stays short and always starts on a visitor turn", () => {
  const trimKey = resolveVisitorSessionKey({ explicitId: "selftest-trim-turns" });
  resetVisitorProfile(trimKey);
  for (let i = 1; i <= 6; i += 1) {
    ingestVisitorTurn(trimKey, `Visitor turn ${i}`);
    ingestAssistantTurn(trimKey, `Assistant turn ${i}.`, { visitorText: `Visitor turn ${i}` });
  }
  ingestVisitorTurn(trimKey, "Visitor turn 7");
  const trimmed = getRecentConversationMessages(trimKey, "Visitor turn 7");
  assert.ok(trimmed.length <= 8, `expected <= 8 messages, got ${trimmed.length}`);
  assert.strictEqual(trimmed[0].role, "user");
  assert.strictEqual(trimmed[trimmed.length - 1].content, "Visitor turn 7");
  assert.doesNotMatch(trimmed[0].content, /Visitor turn 1/);
  resetVisitorProfile(trimKey);
});
resetVisitorProfile(historyKey);

console.log("Encounter memory");
check("idle gap outlasts a long spoken reply", () => {
  assert.ok(idleResetMs() >= 8 * 60_000, `idleResetMs=${idleResetMs()} must cover ~90s of speech plus thinking`);
});
check("a name Godfrey already used is kept even if the visitor phrasing was odd", () => {
  assert.strictEqual(extractAddressedName("Thank you, Uli. [short pause] Well, you’ve come to the man himself."), "Uli");
  assert.strictEqual(
    extractAddressedName("That’s the truth of it. Uli, would you have stood otherwise in my place?"),
    "Uli"
  );
  assert.strictEqual(extractAddressedName("Ada Dixon was only eight. Seven of them drowned."), null);
  assert.strictEqual(extractAddressedName("Well, I’m here to answer it. You want the truth of it?"), null);
});
check("a known name is still on the card after the wreck telling and a sympathy turn", () => {
  const key = resolveVisitorSessionKey({ explicitId: "selftest-uli-memory" });
  resetVisitorProfile(key);
  ingestVisitorTurn(key, welcomePrompt);
  ingestAssistantTurn(
    key,
    "You found me, then. Before you begin, give me your name. I’ve given mine.",
    { visitorText: welcomePrompt }
  );
  ingestVisitorTurn(key, "Uli");
  ingestAssistantTurn(key, "Thank you, Uli. Say what you will.", { visitorText: "Uli" });
  ingestVisitorTurn(key, "What happened on the night?");
  ingestAssistantTurn(
    key,
    "That’s the truth of it. Uli, would you have stood otherwise in my place?",
    { visitorText: "What happened on the night?" }
  );
  const block = buildVisitorContextBlock(ingestVisitorTurn(key, "I feel bad about the people who died."));
  assert.match(block, /Name: Uli/);
  assert.match(block, /Never ask who you are speaking with/);
  assert.doesNotMatch(block, /You do not know their name/);
  resetVisitorProfile(key);
});

console.log("Exhibition document search gating");
check("Welcome / R10 / farewell skip file_search", () => {
  assert.deepStrictEqual(
    shouldIncludeDocumentsForTurn(
      "(A visitor has just approached and stands before you. Welcome them warmly in one or two short sentences, in character. Do not wait for them to speak first.)"
    ),
    { include: false, reason: "unreal-owned" }
  );
  assert.strictEqual(
    shouldIncludeDocumentsForTurn(
      "(The visitor has been quiet for a few seconds. Continue the conversation naturally in one or two short sentences that follow from what was just said.)"
    ).include,
    false
  );
  assert.strictEqual(
    shouldIncludeDocumentsForTurn(
      "(The visitor has walked away and left the scene. Bid them a brief goodbye — use their name if you know it. One short sentence only. End with [farewell].)"
    ).include,
    false
  );
});
check("small talk skips file_search", () => {
  assert.deepStrictEqual(shouldIncludeDocumentsForTurn("Hi, I'm Stephanie."), {
    include: false,
    reason: "chat-followup",
  });
  assert.strictEqual(shouldIncludeDocumentsForTurn("Do you like drinking whisky?").include, false);
  assert.strictEqual(shouldIncludeDocumentsForTurn("Did you always want to be a captain?").include, false);
});
check("wreck / board / named-ship questions include file_search", () => {
  assert.deepStrictEqual(shouldIncludeDocumentsForTurn("Yes, I would love for you to talk about the shipwreck."), {
    include: true,
    reason: "source-grounding",
  });
  assert.strictEqual(shouldIncludeDocumentsForTurn("What could you have done differently?").include, true);
  assert.strictEqual(shouldIncludeDocumentsForTurn("But what about the Laughing Wave?").include, true);
  assert.strictEqual(shouldIncludeDocumentsForTurn("What can you tell me about Annie Simpson?").include, true);
  assert.strictEqual(shouldIncludeDocumentsForTurn("Why do you think the board judged you hard?").include, true);
});

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All visitor profile checks passed.");
