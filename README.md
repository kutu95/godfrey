# Captain John Godfrey Chat App

A Node.js web app that simulates a conversation with Captain John Godfrey (SS Georgette, 1876) using either Anthropic Claude or OpenAI.

## 1) Install dependencies

```bash
npm install
```

## 2) Add your API key(s)

Edit `.env`:

```env
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_openai_key_here
```

## 3) Add source documents

Place your PDF files in the `docs/` folder.

## 4) Upload PDFs for Anthropic (one-time per document set)

Run the one-time upload script to send PDFs to the Anthropic Files API and generate `file-ids.json`:

```bash
node upload-docs.js
```

The script logs each uploaded filename and file ID, then writes all IDs to `file-ids.json`.

**Source of truth:** After you change documents on your **development machine**, run `upload-docs.js` there, then **commit and push** `file-ids.json` with the rest of the app. Production servers should use that repository copy (see **Deploying updates** below), not a separately edited file on the server.

## 5) Upload PDFs for OpenAI (one-time per document set)

Run this script to create an OpenAI vector store and upload your PDFs:

```bash
node upload-openai-docs.js
```

The script writes vector-store metadata to `openai-file-ids.json`.

## 6) Start the server

```bash
node server.js
```

Open your browser at [http://localhost:3000](http://localhost:3000).

## 7) Deploying updates (e.g. VPS)

### Standard server update procedure

Use this from your server shell:

```bash
cd /apps/godfrey
git pull origin main
```

If your process manager does not auto-reload the app, restart after pulling (example):

```bash
pm2 restart godfrey-app
```

Pulling updates keeps the server in sync with the repository. The committed **`file-ids.json` from your dev host is the master** for Anthropic file IDs; it is meant to be in the repo and updated on the server when you pull.

If `git pull` refuses because the server has local changes to `file-ids.json`, drop those edits so Git can replace the file with the version from the repository:

```bash
cd /apps/godfrey
git restore file-ids.json
git pull origin main
```

Use the same pattern for `openai-file-ids.json` if that file was modified only on the server but you want the repository copy to win.

## Notes

- The UI includes a provider switcher so you can choose Claude or OpenAI.
- The app remembers your last selected provider in `provider-config.json` and uses it after restart.
- Anthropic context comes from `file-ids.json` (uploaded via `upload-docs.js`).
- OpenAI context comes from `openai-file-ids.json` and its vector store (uploaded via `upload-openai-docs.js`).
- Document files are sent on the first turn by default, then omitted on later turns for speed.
- Use "Refresh Document Context (Next Reply)" in the UI when you want the next response to include document context again.
- The chat input includes a Dictate button for browser speech-to-text (when supported).
- Speech settings now support three playback modes: no speech, simple browser speech, and OpenAI speech.
- You can tune voice settings in-app (voice/model/speed/rate/pitch) and provide a voice expression prompt for tone and emotion.
- A British accent boost toggle and "Apply Strong British Preset" button are available to maximize British delivery in both OpenAI and browser speech.
- The app includes an Admin system prompt panel to load, append to, or replace the prompt while running.
- Prompt changes are saved to `system-prompt.json` and persist across server restarts.
- Keep your API key private and never expose it in frontend code.
- To deploy publicly, you can host this Express app on Railway, Render, or a VPS.
