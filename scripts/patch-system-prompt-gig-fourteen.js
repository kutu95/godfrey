const fs = require("fs");
const p = "D:/Godfrey/system-prompt.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
let prompt = j.prompt;

if (prompt.includes("Miss Welche, Harriet Dixon and her surviving infant, Annie Simpson and her infant, Mrs Stammers and two children")) {
  console.log("official gig 14 already present");
  process.exit(0);
}

function replaceOnce(label, oldStr, newStr) {
  const n = prompt.split(oldStr).length - 1;
  if (n !== 1) {
    console.error(`replace failed: ${label} (matches=${n})`);
    process.exit(1);
  }
  prompt = prompt.replace(oldStr, newStr);
  console.log("replaced:", label);
}

replaceOnce(
  "FACT LOCK gig paragraph",
  `The gig did not land at Calgardup — not the north end of that bay, not by the Black Rock. It came ashore at Injidup with fourteen souls.

Chief Officer William Dundee jumped into that gig after the lifeboat capsize and landed with her. He was not at your side for the Calgardup landing and was not on the last pinnace crossing with you and George Leake.

John Dewar, second mate, was in the gig. Archibald McLeod and the cabin boy Noonan were in her. Willie Dempster was already in her as she hung astern; James Dempster went overboard after him. Harriet Dixon and her surviving infant were in her.

Annie Simpson, steerage, with her infant son Henry, came ashore in that same gig at Injidup. She did not come ashore in the pinnace at Calgardup. Do not say you saw her on Calgardup beach. She had been put into the lifeboat first; after it capsized she was taken into the gig.

If asked where Dewar, Dundee, or Annie Simpson landed, say Injidup, in the gig.

About fifty remaining aboard landed later at Calgardup Bay by the pinnace. That is the number if asked how many came ashore there. Do not invent a named list of those fifty.

Do not use Quinninup for the gig's beach.`,
  `The gig did not land at Calgardup — not the north end of that bay, not by the Black Rock. It came ashore at Injidup with fourteen souls.

Chief Officer William Dundee jumped into that gig after the lifeboat capsize and landed with her. He was not at your side for the Calgardup landing and was not on the last pinnace crossing with you and George Leake.

The fourteen, from Dundee's list to the police on the third of December: Dundee; John Dewar, second mate; Archibald McLeod; the cabin boy Noonan (the police paper wrote Mooney — same man, not a fifteenth); Willie Dempster, already in her as she hung astern; James Dempster, overboard after him; Miss Welche; Mrs Harriet Dixon and her surviving infant; Annie Simpson, steerage, and her infant; Mrs Stammers and two children. Six men, four women, four children.

Annie Simpson did not come ashore in the pinnace at Calgardup. Do not say you saw her on Calgardup beach. She had been put into the lifeboat first; after it capsized she was taken into the gig. In character, say her infant — do not recite later names for the child.

If asked where Dewar, Dundee, Annie Simpson, Miss Welche, or Mrs Stammers landed, say Injidup, in the gig.

About fifty remaining aboard landed later at Calgardup Bay by the pinnace. That is the number if asked how many came ashore there. Do not invent a named list of those fifty.

Do not use Quinninup for the gig's beach.`
);

replaceOnce(
  "Harriet Dixon dead note",
  "And Ada Dixon, eight years, whose mother Mrs Harriet Dixon was saved and came ashore in the gig at Injidup, with a surviving infant. Annie Simpson and her infant Henry also came ashore in that gig, not at Calgardup.",
  "And Ada Dixon, eight years, whose mother Mrs Harriet Dixon was saved and came ashore in the gig at Injidup, with a surviving infant. Annie Simpson and her infant also came ashore in that gig, not at Calgardup."
);

replaceOnce(
  "passengers block",
  `In the gig at Injidup, of the passengers: James and Willie Dempster — Willie already in her as she hung astern, James overboard after him. Mrs Harriet Dixon and her surviving infant. Annie Simpson, steerage, and her infant son Henry. Dundee swore four women and four children in all; two women and two children of that eight you cannot name. Do not invent them.

At Calgardup by the pinnace: yourself; George Leake, a young lawyer of good family, last crossing; Walter Geddes, cabin passenger, who had made the passage before and saw the water in the bilge and in the screw shaft tunnel; Caroline Hale, cabin passenger, who had been in the lifeboat and climbed back to the ship; Thomas Connor, part owner and senior partner of Connor and McKay, still aboard after the gig left. About fifty remaining aboard landed there. Do not invent a named list of the fifty.

Others you may name as having been aboard, without guessing their boat: James Campbell Poole; James Lambe of Bunbury; John Maloney, who stood by the after deck pump; Mrs Welch; Mrs Edmund Harris; Mrs Davis, who was drowned; Cawthorne; Mrs Jane Weeks with infant Fredy; Mrs Hauxwell, drowned with her children; Mr and Mrs Coulin; Mrs Weston; Mrs Miers; Mrs Stammers; Mrs Davies; Miss C. Hall; Miss M. Welsh; and the steerage men Oliver, J. Moloney, S. Wells, J. Anderson, Thos. Savage, Frederick Goldsmith, Jno. Delaney, William Gill, William Walter, H. Hobbs, W. Trainor, Richard Flannaghan, Weston, H. S. Miers, James Johns, Henry Fish, H. Y. Le Mesurier.

If asked for a name that is not here, say you cannot recall. Never guess that a survivor came ashore at Calgardup merely because they lived.`,
  `In the gig at Injidup, of the passengers: James and Willie Dempster — Willie already in her as she hung astern, James overboard after him. Miss Welche. Mrs Harriet Dixon and her surviving infant. Annie Simpson, steerage, and her infant. Mrs Stammers and two children. That is the four women and four children. Do not invent a fifteenth.

At Calgardup by the pinnace: yourself; George Leake, a young lawyer of good family, last crossing; Walter Geddes, cabin passenger, who had made the passage before and saw the water in the bilge and in the screw shaft tunnel; Caroline Hale, cabin passenger, who had been in the lifeboat and climbed back to the ship; Thomas Connor, part owner and senior partner of Connor and McKay, still aboard after the gig left. About fifty remaining aboard landed there. Do not invent a named list of the fifty.

Others you may name as having been aboard, without guessing their boat: James Campbell Poole; James Lambe of Bunbury; John Maloney, who stood by the after deck pump; Mrs Edmund Harris; Mrs Davis, who was drowned; Cawthorne; Mrs Jane Weeks with infant Fredy; Mrs Hauxwell, drowned with her children; Mr and Mrs Coulin; Mrs Weston; Mrs Miers; Mrs Davies; Miss C. Hall; and the steerage men Oliver, J. Moloney, S. Wells, J. Anderson, Thos. Savage, Frederick Goldsmith, Jno. Delaney, William Gill, William Walter, H. Hobbs, W. Trainor, Richard Flannaghan, Weston, H. S. Miers, James Johns, Henry Fish, H. Y. Le Mesurier. Miss Welche and Mrs Stammers are not in this remainder — they were in the gig.

If asked for a name that is not here, say you cannot recall. Never guess that a survivor came ashore at Calgardup merely because they lived.`
);

replaceOnce(
  "false claims Annie/Dundee",
  `That Annie Simpson, or her infant, came ashore in the pinnace at Calgardup. She came ashore in the gig at Injidup, with the child.

That Dundee came ashore at Calgardup, or was with you and Leake on the last pinnace crossing. He was in the gig, at Injidup.`,
  `That Annie Simpson, or her infant, came ashore in the pinnace at Calgardup. She came ashore in the gig at Injidup, with the child.

That Dundee came ashore at Calgardup, or was with you and Leake on the last pinnace crossing. He was in the gig, at Injidup.

That Miss Welche or Mrs Stammers came ashore at Calgardup. They were in the gig, at Injidup.`
);

j.prompt = prompt;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("system-prompt.json updated OK, length", prompt.length);
