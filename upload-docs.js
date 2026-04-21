const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { toFile } = require("@anthropic-ai/sdk");
require("dotenv").config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function uploadDocuments() {
  const docsDir = path.join(__dirname, "docs");

  if (!fs.existsSync(docsDir)) {
    console.error("docs folder not found. Create docs/ and add your PDFs first.");
    process.exit(1);
  }

  const MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".md": "text/markdown",
    ".txt": "text/plain",
  };
  const candidateFiles = fs.readdirSync(docsDir).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return Boolean(MIME_BY_EXT[ext]);
  });
  const lowercaseNames = new Set(candidateFiles.map((file) => file.toLowerCase()));
  const hasGeorgeLeakeMarkdown = lowercaseNames.has("george leake.md");

  const files = [];
  for (const filename of candidateFiles) {
    const lower = filename.toLowerCase();
    if (hasGeorgeLeakeMarkdown && lower === "acc871a.pdf") {
      console.warn("Skipping acc871a.pdf because George Leake.md is present (duplicate source).");
      continue;
    }
    const fullPath = path.join(docsDir, filename);
    const size = fs.statSync(fullPath).size;
    if (size === 0) {
      console.warn(`Skipping empty file: ${filename}`);
      continue;
    }
    files.push(filename);
  }

  if (files.length === 0) {
    console.error("No non-empty supported docs found in docs/. Add .pdf, .md, or .txt files, then run this script again.");
    process.exit(1);
  }

  const uploaded = [];

  console.log(`Found ${files.length} supported document(s). Uploading...`);

  for (const filename of files) {
    const fullPath = path.join(docsDir, filename);
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    console.log(`Uploading ${filename}...`);

    const fileObject = await toFile(fs.readFileSync(fullPath), filename, {
      type: mimeType,
    });

    const result = await anthropic.beta.files.upload({
      file: fileObject,
    });

    uploaded.push({
      filename,
      fileId: result.id,
    });

    console.log(`Uploaded ${filename} -> ${result.id}`);
  }

  const outputPath = path.join(__dirname, "file-ids.json");
  fs.writeFileSync(outputPath, JSON.stringify(uploaded, null, 2));

  console.log("\nUpload complete. Saved IDs to file-ids.json:\n");
  for (const item of uploaded) {
    console.log(`${item.filename}: ${item.fileId}`);
  }
}

uploadDocuments().catch((error) => {
  console.error("Upload failed:", error?.message || error);
  process.exit(1);
});
