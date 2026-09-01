# Godfrey occasion scripts

Reusable, authored speeches Godfrey can deliver **verbatim** through the normal Unreal TTS + ACE lip-sync path (no LLM rewrite).

## Add a new occasion

1. Create `occasions/<id>.md` (use lowercase kebab-case for the filename).
2. Add front-matter and the spoken script (performance cues allowed):

```md
---
id: birthday-jane
title: Birthday wishes for Jane
recipient: Jane
conversationEnd: false
notes: Optional operator notes.
---

[serious]
Jane, … your spoken text here …
```

3. Restart is **not** required — the Brain re-reads the folder on each list/speak call.
4. Queue it from Admin → **Occasion scripts**, or:

```bat
cd /d D:\Godfrey
node scripts/speak-occasion.js birthday-jane
```

## Play an occasion (operator checklist)

1. Start the Godfrey Brain (`npm start` in `D:\Godfrey`).
2. Open Unreal, PIE `Godfrey_World` (exhibition queue poll running as usual).
3. Open `http://localhost:3000`, sign in as Admin.
4. Under **Occasion scripts**, choose the script → **Queue for Unreal**.
5. Godfrey should begin speaking within a few seconds (Unreal polls `/api/exhibition/unreal-tts-status`).

Cues in `[square brackets]` are stripped before ElevenLabs; Unreal may use `[gesture:…]` markers for body performance.

## Notable visitor recognition

Some occasion scripts are also the one-shot recognition beat for a watchlist visitor
(`config/notable-visitors.json`). Godfrey identifies them from what they say (given name,
then family name), then speaks the matching occasion **verbatim** — the LLM does not rewrite
it. Current watchlist scripts:

- Marcia van Zeller — `marcia-van-zeller`
- Stef (Stefanie) Koens — `stef-koens`

Queue the same script from Admin if the mic misses the name. Do not queue it if the
automatic recognition already ran this encounter, or he will greet them twice.

`john-sullivan` (Pancake John) is operator-only — not on the watchlist, because John is
too common a given name.

