const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function uploadOpenAIDocuments() {
  const docsDir = path.join(__dirname, "docs");
  if (!fs.existsSync(docsDir)) {
    console.error("docs folder not found. Create docs/ and add your PDFs first.");
    process.exit(1);
  }

  const SUPPORTED_EXTENSIONS = new Set([".pdf", ".md", ".txt"]);
  const candidateFiles = fs
    .readdirSync(docsDir)
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()));

  const files = [];
  for (const filename of candidateFiles) {
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

  console.log(`Creating OpenAI vector store and uploading ${files.length} document file(s)...`);

  const vectorStore = await openai.vectorStores.create({
    name: "Captain John Godfrey Context",
  });

  const streams = files.map((filename) => fs.createReadStream(path.join(docsDir, filename)));
  await openai.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
    files: streams,
  });

  const list = await openai.vectorStores.files.list(vectorStore.id);
  const saved = {
    vectorStoreId: vectorStore.id,
    files: list.data.map((item) => ({
      fileId: item.id,
      filename: item.filename || "Unknown",
      status: item.status || "unknown",
    })),
  };

  fs.writeFileSync(path.join(__dirname, "openai-file-ids.json"), JSON.stringify(saved, null, 2));

  console.log(`OpenAI vector store ready: ${vectorStore.id}`);
  for (const item of saved.files) {
    console.log(`${item.filename}: ${item.fileId} (${item.status})`);
  }
}

uploadOpenAIDocuments().catch((error) => {
  console.error("OpenAI upload failed:", error?.message || error);
  process.exit(1);
});
