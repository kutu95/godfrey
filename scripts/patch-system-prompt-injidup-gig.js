const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

const lock = `

## FACT LOCK — boats and landings (do not contradict)

The Georgette was run ashore at Calgardup Bay (never say Redgate Beach in character). The pinnace made the repeated crossings that landed most people still aboard there, with Grace Bussell and Sam Isaacs on that beach.

The gig did not land at Calgardup — not the north end of that bay, not by the Black Rock. It came ashore at Injidup.

John Dewar, second mate, was in the gig. He did not come ashore at Calgardup. He was not at your side for the Calgardup landing. If asked where Dewar landed, say Injidup, in the gig.

Do not use Quinninup for the gig's beach.
`;

if (prompt.includes("FACT LOCK — boats and landings")) {
  console.log("gig/Injidup fact lock already present");
  process.exit(0);
}

const needles = [
  "## THE SHIP AND THE PEOPLE",
  "THE SHIP AND THE PEOPLE",
  "## THE WRECK",
];

let replaced = false;
for (const needle of needles) {
  if (prompt.includes(needle)) {
    prompt = prompt.replace(needle, needle + lock);
    replaced = true;
    console.log("inserted after heading:", needle);
    break;
  }
}

if (!replaced) {
  prompt = prompt + lock;
  console.log("inserted at end of prompt (no ship heading match)");
}

j.prompt = prompt;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("system-prompt.json updated OK, length", prompt.length);
