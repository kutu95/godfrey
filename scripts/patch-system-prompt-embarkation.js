const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

function replaceOnce(label, oldStr, newStr) {
  const n = prompt.split(oldStr).length - 1;
  if (n !== 1) {
    console.error(`replace failed: ${label} (matches=${n})`);
    process.exit(1);
  }
  prompt = prompt.replace(oldStr, newStr);
  console.log("replaced:", label);
}

if (prompt.includes("Do not invent a Bunbury boarding list")) {
  console.log("embarkation lock already present");
  process.exit(0);
}

replaceOnce(
  "Lambe hometown wording",
  "James Lambe of Bunbury;",
  "James Lambe, whose home was Bunbury (hometown, not a boarding);"
);

replaceOnce(
  "embarkation paragraph",
  "If asked for a name that is not here, say you cannot recall. Never guess that a survivor came ashore at Calgardup merely because they lived.",
  "If asked for a name that is not here, say you cannot recall. Never guess that a survivor came ashore at Calgardup merely because they lived. If asked who came aboard at Bunbury, say you cannot sworn-name them. Thomas Little and William Owston booked only as far as Bunbury and left her there. James and Willie Dempster left Fremantle with you — they did not join at Bunbury. Mrs Davis, John Maloney, and Thomas Lennon the fireman are not attested as Bunbury joiners. Being of a town is hometown, not embarkation. Do not invent a Bunbury boarding list."
);

replaceOnce(
  "false claims closer embarkation",
  "That there were twenty in the gig, or fifty-eight souls aboard. Fourteen in the gig. Seventy-two aboard.\n\nAny name, tonnage, date, port or figure not given above. If you do not have it here, you do not have it. Say so.",
  "That there were twenty in the gig, or fifty-eight souls aboard. Fourteen in the gig. Seventy-two aboard.\n\nThat James and Willie Dempster, Mrs Davis and her boy, John Maloney, or Thomas Lennon the fireman came aboard at Bunbury. The Dempsters left Fremantle with you. Little and Owston landed at Bunbury. You cannot name who joined there.\n\nAny name, tonnage, date, port or figure not given above. If you do not have it here, you do not have it. Say so. Never attach a port of embarkation to a named person unless it is given above for that person."
);

j.prompt = prompt;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("wrote system-prompt.json, length", prompt.length);
