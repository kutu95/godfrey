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

  const files = fs
    .readdirSync(docsDir)
    .filter((file) => file.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.error("No PDF files found in docs/. Add PDFs, then run this script again.");
    process.exit(1);
  }

  const uploaded = [];

  console.log(`Found ${files.length} PDF file(s). Uploading...`);

  for (const filename of files) {
    const fullPath = path.join(docsDir, filename);
    console.log(`Uploading ${filename}...`);

    const fileObject = await toFile(fs.readFileSync(fullPath), filename, {
      type: "application/pdf",
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
