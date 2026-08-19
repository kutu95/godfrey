#!/usr/bin/env node
"use strict";

/**
 * Queue an occasion script for Unreal TTS (no LLM).
 *
 * Usage:
 *   node scripts/speak-occasion.js michael-get-well
 *   node scripts/speak-occasion.js --list
 *
 * Requires Brain running and ADMIN_PASSWORD in .env (or env).
 */

const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = String(process.env.GODFREY_BRAIN_URL || process.env.GODFREY_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--list") || args.includes("-l")) {
    return { list: true, occasionId: null };
  }
  const occasionId = args.find((a) => !a.startsWith("-")) || null;
  return { list: false, occasionId };
}

function collectSetCookie(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieHeaderFromSetCookie(setCookies) {
  return setCookies
    .map((c) => String(c).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function main() {
  const { list, occasionId } = parseArgs(process.argv);
  if (!list && !occasionId) {
    console.error("Usage: node scripts/speak-occasion.js <occasionId>");
    console.error("       node scripts/speak-occasion.js --list");
    process.exit(1);
  }
  if (!ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD is not set in the environment or D:\\Godfrey\\.env");
    process.exit(1);
  }

  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok) {
    console.error("Admin login failed:", loginBody.error || loginRes.status);
    process.exit(1);
  }
  const cookie = cookieHeaderFromSetCookie(collectSetCookie(loginRes));
  if (!cookie) {
    console.error("Admin login succeeded but no session cookie was returned.");
    process.exit(1);
  }

  if (list) {
    const res = await fetch(`${BASE_URL}/api/admin/occasions`, {
      headers: { Cookie: cookie },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(data.error || `List failed HTTP ${res.status}`);
      process.exit(1);
    }
    for (const item of data.occasions || []) {
      console.log(`${item.id}\t${item.title}${item.recipient ? ` (${item.recipient})` : ""}`);
    }
    return;
  }

  const res = await fetch(`${BASE_URL}/api/admin/occasions/speak`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ occasionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(data.error || `Speak failed HTTP ${res.status}`);
    process.exit(1);
  }
  console.log("Queued for Unreal:", {
    occasionId: data.occasionId,
    requestId: data.requestId,
    chars: data.performanceChars,
    statusUrl: data.unrealTts?.statusUrl,
  });
  console.log("With PIE running and exhibition queue poll active, Godfrey should start shortly.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
