const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

const oldBlock = `Structured cue forms (one cue per marker; never combine multiple ideas in one marker):
- Square brackets: timing and pacing [pause], [short pause], [long pause], [quiet pause], and performer states [thinking], [serious], [amused], [emphasis], [idle].
- Asterisks: visible body and attention actions only.`;

const newBlock = `Structured cue forms (one cue per marker; never combine multiple ideas in one marker):
- Square brackets: timing and pacing [pause], [short pause], [long pause], [quiet pause], and performer states [thinking], [serious], [amused], [emphasis], [idle].
- Named Unreal body gestures (from the UNREAL GESTURE LIBRARY addendum only): [gesture:CatalogId], e.g. [gesture:TwoThumbsUp_01]. Also accepted: [action:CatalogId] or [CatalogId] when CatalogId is listed in that addendum.
- Asterisks: visible body and attention actions only (non-montage direction Unreal may ignore).

Never invent CatalogIds. Prefer at most one [gesture:…] per reply. Unreal blends gestures briefly (~0.2s) on the upper body — do not stack rapid incompatible gestures.`;

if (!prompt.includes(oldBlock)) {
  console.error("OLD BLOCK NOT FOUND");
  process.exit(1);
}
prompt = prompt.replace(oldBlock, newBlock);

const oldRules = `Rules:
1. Use at most 1–3 cues total in a normal answer (counting bracket cues and asterisk cues together).
2. Use [thinking] before a reflective answer.
3. Use [serious] for sombre historical material, death, danger, regret, shipwreck, loss, or responsibility.
4. Use [amused] only for dry humour or warmly ironic moments.
5. Use [emphasis] before an important sentence; do not repeat it.
6. Use [short pause], [long pause], [quiet pause], or [pause] for dramatic pacing where appropriate.
7. Use asterisk cues only for visible body or attention shifts.
8. Never embed cues inside ordinary spoken sentences as inline parentheticals.
9. Never explain what the cues mean.
10. Keep the spoken answer natural once cues are removed.`;

const newRules = `Rules:
1. Use at most 1–3 cues total in a normal answer (counting bracket cues, gesture cues, and asterisk cues together). Prefer at most one named [gesture:…] per reply.
2. Use [thinking] before a reflective answer.
3. Use [serious] for sombre historical material, death, danger, regret, shipwreck, loss, or responsibility.
4. Use [amused] only for dry humour or warmly ironic moments.
5. Use [emphasis] before an important sentence; do not repeat it.
6. Use [short pause], [long pause], [quiet pause], or [pause] for dramatic pacing where appropriate.
7. Use [gesture:CatalogId] when a specific body performance from the UNREAL GESTURE LIBRARY addendum materially helps (approval, describing size/distance, farewell wave, laugh, etc.).
8. Use asterisk cues only for visible body or attention shifts that are not covered by a catalog gesture.
9. Never embed cues inside ordinary spoken sentences as inline parentheticals.
10. Never explain what the cues mean.
11. Keep the spoken answer natural once cues are removed.`;

if (!prompt.includes(oldRules)) {
  console.error("OLD RULES NOT FOUND");
  process.exit(1);
}
prompt = prompt.replace(oldRules, newRules);

const oldExamples = `Bracket examples (performer and pacing):
[thinking]
[serious]
[amused]
[emphasis]
[idle]
[short pause]
[long pause]
[quiet pause]
[pause]`;

const newExamples = `Bracket examples (performer, pacing, and named gestures):
[thinking]
[serious]
[amused]
[emphasis]
[idle]
[short pause]
[long pause]
[quiet pause]
[pause]
[gesture:TwoThumbsUp_01]
[gesture:SpeakingDescribeSize_01]
[gesture:ThinkingHandToChin_01]
[gesture:FarewellWave_01]`;

if (!prompt.includes(oldExamples)) {
  console.error("OLD EXAMPLES NOT FOUND");
  process.exit(1);
}
prompt = prompt.replace(oldExamples, newExamples);

j.prompt = prompt;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n", "utf8");
console.log("system-prompt.json updated OK, length", prompt.length);
