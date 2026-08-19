"use strict";

const fs = require("fs");
const path = require("path");

const OCCASIONS_DIR = path.join(__dirname, "..", "occasions");
/** Lowercase kebab-case ids; filename is always `<id>.md`. */
const OCCASION_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Minimal front-matter parser (key: value lines). No extra dependency.
 * @param {string} raw
 * @param {string} filename
 */
function parseOccasionMarkdown(raw, filename) {
  const source = String(raw || "");
  let meta = {};
  let body = source.trim();

  if (source.startsWith("---")) {
    const end = source.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = source.slice(3, end).trim();
      body = source.slice(end + 4).trim();
      for (const line of fm.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const m = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (!m) {
          continue;
        }
        let value = m[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        }
        meta[m[1]] = value;
      }
    }
  }

  const idFromFile = path.basename(filename, path.extname(filename));
  const id =
    typeof meta.id === "string" && meta.id.trim() ? meta.id.trim() : idFromFile;

  return {
    id,
    title: typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : id,
    recipient:
      typeof meta.recipient === "string" && meta.recipient.trim() ? meta.recipient.trim() : null,
    notes: typeof meta.notes === "string" && meta.notes.trim() ? meta.notes.trim() : null,
    conversationEnd: meta.conversationEnd === true,
    text: body,
    filename: path.basename(filename),
  };
}

function ensureOccasionsDir() {
  if (!fs.existsSync(OCCASIONS_DIR)) {
    fs.mkdirSync(OCCASIONS_DIR, { recursive: true });
  }
  return OCCASIONS_DIR;
}

function isValidOccasionId(id) {
  return typeof id === "string" && OCCASION_ID_RE.test(id) && id === path.basename(id);
}

/**
 * Safe absolute path for `occasions/<id>.md`, or null if id is invalid / escapes dir.
 * @param {string} id
 */
function resolveOccasionPath(id) {
  if (!isValidOccasionId(id)) {
    return null;
  }
  const full = path.join(OCCASIONS_DIR, `${id}.md`);
  const resolved = path.resolve(full);
  const root = path.resolve(OCCASIONS_DIR);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix)) {
    return null;
  }
  return resolved;
}

/**
 * Safe absolute path for an existing occasion filename under OCCASIONS_DIR.
 * @param {string} filename
 */
function resolveSafeOccasionFile(filename) {
  const base = path.basename(String(filename || ""));
  if (!base || base !== String(filename || "") || !base.toLowerCase().endsWith(".md")) {
    return null;
  }
  if (base.toLowerCase().startsWith("readme")) {
    return null;
  }
  const resolved = path.resolve(path.join(OCCASIONS_DIR, base));
  const root = path.resolve(OCCASIONS_DIR);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(prefix)) {
    return null;
  }
  return resolved;
}

function formatFrontMatterValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const s = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
  if (!s) {
    return '""';
  }
  if (/[:#"']/.test(s) || /^\s|\s$/.test(String(value ?? ""))) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * @param {{ id: string, title?: string, recipient?: string|null, notes?: string|null, conversationEnd?: boolean, text: string }} fields
 */
function serializeOccasionMarkdown(fields) {
  const id = String(fields.id || "").trim();
  const title =
    typeof fields.title === "string" && fields.title.trim() ? fields.title.trim() : id;
  const recipient =
    typeof fields.recipient === "string" && fields.recipient.trim()
      ? fields.recipient.trim()
      : "";
  const notes =
    typeof fields.notes === "string" && fields.notes.trim() ? fields.notes.trim() : "";
  const text = String(fields.text || "").trim();
  const lines = ["---", `id: ${id}`, `title: ${formatFrontMatterValue(title)}`];
  if (recipient) {
    lines.push(`recipient: ${formatFrontMatterValue(recipient)}`);
  }
  lines.push(`conversationEnd: ${fields.conversationEnd === true ? "true" : "false"}`);
  if (notes) {
    lines.push(`notes: ${formatFrontMatterValue(notes)}`);
  }
  lines.push("---", "", text, "");
  return lines.join("\n");
}

/**
 * Normalize API/UI body into occasion fields.
 * @param {object} body
 * @param {{ idFromUrl?: string }} [options]
 * @returns {{ id: string, title: string, recipient: string|null, notes: string|null, conversationEnd: boolean, text: string }}
 */
function sanitizeOccasionFields(body, options = {}) {
  const idSource =
    typeof options.idFromUrl === "string" && options.idFromUrl.trim()
      ? options.idFromUrl.trim()
      : typeof body?.id === "string"
        ? body.id.trim()
        : "";
  if (!isValidOccasionId(idSource)) {
    const err = new Error(
      "Invalid occasion id. Use lowercase kebab-case (e.g. birthday-jane)."
    );
    err.status = 400;
    throw err;
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    const err = new Error("Script text is required.");
    err.status = 400;
    throw err;
  }

  const title =
    typeof body?.title === "string" && body.title.trim() ? body.title.trim() : idSource;
  const recipient =
    typeof body?.recipient === "string" && body.recipient.trim()
      ? body.recipient.trim()
      : null;
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  return {
    id: idSource,
    title,
    recipient,
    notes,
    conversationEnd: body?.conversationEnd === true,
    text,
  };
}

/**
 * @returns {Array<{ id: string, title: string, recipient: string|null, notes: string|null, conversationEnd: boolean, filename: string, text: string }>}
 */
function listOccasionScripts() {
  ensureOccasionsDir();
  const names = fs
    .readdirSync(OCCASIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".md") && !name.toLowerCase().startsWith("readme"));
  const items = [];
  for (const name of names) {
    const full = path.join(OCCASIONS_DIR, name);
    try {
      const parsed = parseOccasionMarkdown(fs.readFileSync(full, "utf-8"), name);
      if (parsed.text) {
        items.push(parsed);
      }
    } catch (error) {
      console.error(`occasion-scripts: failed to read ${name}:`, error.message);
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

/**
 * @param {string} occasionId
 */
function getOccasionScript(occasionId) {
  const id = String(occasionId || "").trim();
  if (!id) {
    return null;
  }
  const match = listOccasionScripts().find((item) => item.id === id);
  return match || null;
}

/**
 * Create or overwrite an occasion markdown file.
 * @param {object} fields sanitized fields
 * @param {{ overwrite?: boolean }} [options]
 */
function writeOccasionScript(fields, options = {}) {
  const overwrite = options.overwrite === true;
  ensureOccasionsDir();
  const filePath = resolveOccasionPath(fields.id);
  if (!filePath) {
    const err = new Error("Invalid occasion id path.");
    err.status = 400;
    throw err;
  }

  const existingById = getOccasionScript(fields.id);
  const fileExists = fs.existsSync(filePath);

  if (!overwrite) {
    if (existingById || fileExists) {
      const err = new Error(`Occasion already exists: ${fields.id}`);
      err.status = 409;
      throw err;
    }
  } else if (!existingById && !fileExists) {
    const err = new Error(`Unknown occasion id: ${fields.id}`);
    err.status = 404;
    throw err;
  }

  // Prefer updating the file that currently backs this id (handles id ≠ filename edge cases).
  let targetPath = filePath;
  if (overwrite && existingById?.filename) {
    const existingPath = resolveSafeOccasionFile(existingById.filename);
    if (existingPath) {
      targetPath = existingPath;
    }
  }

  const markdown = serializeOccasionMarkdown(fields);
  fs.writeFileSync(targetPath, markdown, "utf-8");

  // If we updated a non-canonical filename, also ensure canonical <id>.md and remove the old name.
  if (overwrite && targetPath !== filePath) {
    fs.writeFileSync(filePath, markdown, "utf-8");
    try {
      fs.unlinkSync(targetPath);
    } catch (_) {
      /* ignore */
    }
  }

  const saved = getOccasionScript(fields.id);
  if (!saved) {
    const err = new Error("Wrote occasion file but failed to re-read it.");
    err.status = 500;
    throw err;
  }
  return saved;
}

/**
 * @param {string} occasionId
 * @returns {object|null} deleted script metadata, or null if not found
 */
function deleteOccasionScript(occasionId) {
  const script = getOccasionScript(occasionId);
  if (!script) {
    return null;
  }
  const filePath = resolveSafeOccasionFile(script.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  fs.unlinkSync(filePath);
  return script;
}

module.exports = {
  OCCASIONS_DIR,
  OCCASION_ID_RE,
  parseOccasionMarkdown,
  serializeOccasionMarkdown,
  sanitizeOccasionFields,
  isValidOccasionId,
  resolveOccasionPath,
  listOccasionScripts,
  getOccasionScript,
  writeOccasionScript,
  deleteOccasionScript,
  ensureOccasionsDir,
};
