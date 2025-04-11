const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const poppler = require("pdf-poppler");
const { ocr } = require("llama-ocr");
require("dotenv").config();
const { sendToLLM } = require("./llmHandler");
const { generateMedicalSummaryPrompt } = require("./promptManager");

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, "uploads");
const imageDir = path.join(__dirname, "images");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const name = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, name);
  },
});
const upload = multer({ storage });

async function processImage(filePath) {
  const result = await ocr({
    filePath,
    apiKey: process.env.TOGETHER_API_KEY,
  });
  return result;
}

async function processPDF(filePath, outputPrefix) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(dataBuffer);
    if (parsed.text && parsed.text.trim().length > 30) {
      console.log("✅ Used digital parsing");
      return { text: parsed.text.trim(), source: "parser" };
    }
  } catch (err) {
    console.warn("⚠️ Digital parse failed:", err.message);
  }
  console.log("🔁 Falling back to OCR");
  const imagePaths = await convertPDFToImages(filePath, outputPrefix);
  const allTexts = [];
  for (const img of imagePaths) {
    const result = await processImage(img);
    allTexts.push(result);
  }
  return { text: allTexts.join("\n\n"), source: "ocr" };
}

async function convertPDFToImages(filePath, prefix) {
  const options = {
    format: "jpeg",
    out_dir: imageDir,
    out_prefix: prefix,
    page: null,
  };
  await poppler.convert(filePath, options);
  const allFiles = fs.readdirSync(imageDir);
  return allFiles
    .filter((file) => file.startsWith(prefix) && file.endsWith(".jpg"))
    .map((file) => path.join(imageDir, file));
}

app.post("/upload", upload.single("file"), async (req, res) => {
  const start = Date.now();
  console.log("📥 Upload started");
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  const filePath = path.join(uploadDir, req.file.filename);
  const fileExt = path.extname(req.file.originalname).toLowerCase();
  const outputPrefix = path.parse(req.file.filename).name;

  try {
    let result;
    if (fileExt === ".pdf") {
      console.log("📄 Processing PDF...");
      result = await processPDF(filePath, outputPrefix);
    } else if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
      console.log("🖼 Processing Image...");
      const ocrText = await processImage(filePath);
      result = { text: ocrText, source: "ocr" };
    } else {
      return res.status(400).json({ message: "Unsupported file type" });
    }
    console.log("🧠 Creating prompt...");
    const prompt = generateMedicalSummaryPrompt(result.text);
    console.log("🤖 Sending to LLM...");
    const llmResponse = await sendToLLM(prompt);
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✅ Completed in ${duration}s`);
    res.status(200).json({
      message: `Processed with ${result.source}`,
      llmResponse,
      processingTime: `${duration}s`,
    });
  } catch (err) {
    console.error("❌ Error during processing:", err.message);
    res.status(500).json({ message: "Processing failed", error: err.message });
  }
});

app.listen(4000, () => {
  console.log("✅ Server running on http://localhost:4000");
});
