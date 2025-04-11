const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { ocr } = require("llama-ocr");
require("dotenv").config();

const { sendToLLM } = require("./llmHandler");
const { generateMedicalSummaryPrompt } = require("./promptManager");

const app = express();
app.use(cors());
app.use(express.json());

// Uploads directory
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${timestamp}-${cleanName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

// Handle image OCR
async function processImage(filePath) {
  return await ocr({
    filePath,
    apiKey: process.env.TOGETHER_API_KEY,
  });
}

// Handle PDF parsing
async function processPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(dataBuffer);
  if (parsed.text && parsed.text.trim().length > 0) {
    console.log("✅ PDF parsed successfully");
    return { text: parsed.text.trim(), source: "parser" };
  }
  throw new Error("Empty or invalid PDF content");
}

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  const start = Date.now();
  console.log("📥 Upload received");

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = path.join(uploadDir, req.file.filename);
  const fileExt = path.extname(req.file.originalname).toLowerCase();

  try {
    let result;

    if (fileExt === ".pdf") {
      console.log("📄 Processing PDF...");
      result = await processPDF(filePath);
    } else {
      console.log("🖼 Processing Image...");
      const ocrText = await processImage(filePath);
      result = { text: ocrText, source: "ocr" };
    }

    console.log("🧠 Generating prompt...");
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
    console.error("❌ Processing error:", err.message);
    res.status(500).json({ message: "Processing failed", error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server live at http://localhost:${PORT}`);
});
