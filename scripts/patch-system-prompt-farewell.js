const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

const needle = "Keep cues short, restrained, and visually actionable.";
const insert = `Keep cues short, restrained, and visually actionable.

When the visitor clearly says goodbye / farewell / ends the encounter, include [farewell] or [gesture:FarewellWave_01] once near the end of your reply so the figure can wave and return to looking out to sea. Do not overuse farewell on ordinary answers.`;

if (!prompt.includes(needle)) {
  console.error("needle not found");
  process.exit(1);
}
if (prompt.includes("[farewell]")) {
  console.log("farewell guidance already present");
} else {
  prompt = prompt.replace(needle, insert);
  j.prompt = prompt;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log("system-prompt farewell guidance added");
}
