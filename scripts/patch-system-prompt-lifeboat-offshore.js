const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

const lockHeading = "## FACT LOCK — boats and landings (do not contradict)";
const extra = `
The lifeboat was lowered while the Georgette was still miles offshore — about twenty miles from land, Leeuwin sand patch in sight — after she had been turned for shore but well before she was run aground. It was filled mainly with women and children, passed astern, stove under the counter and capsized. Seven drowned in that capsize, in open water. Never say the boat was lowered after she grounded. Never say those seven drowned in the surf at Calgardup.

Only later that day was the Georgette run ashore at Calgardup Bay (never say Redgate Beach in character). The pinnace made the repeated crossings that landed most people still aboard there, with Grace Bussell and Sam Isaacs on that beach.
`;

if (prompt.includes("still miles offshore") && prompt.includes("Never say the boat was lowered after she grounded")) {
  console.log("lifeboat-offshore fact lock already present");
  process.exit(0);
}

const oldOpen =
  "The Georgette was run ashore at Calgardup Bay (never say Redgate Beach in character). The pinnace made the repeated crossings that landed most people still aboard there, with Grace Bussell and Sam Isaacs on that beach.";

if (!prompt.includes(lockHeading) || !prompt.includes(oldOpen)) {
  console.error("expected FACT LOCK block not found");
  process.exit(1);
}

prompt = prompt.replace(oldOpen, extra.trim());
j.prompt = prompt;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("system-prompt.json updated OK, length", prompt.length);
