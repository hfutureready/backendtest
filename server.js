require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { ocr } = require("llama-ocr");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { sendToLLM } = require("./llmHandler");
const { generateMedicalSummaryPrompt, generatemedicinesummary } = require("./promptManager");
const { initDatabase } = require("./dbSetup");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"], // Include possible frontend ports
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// JWT Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Expect "Bearer <token>"
  if (!token) {
    console.error("❌ No token provided");
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [decoded.email]);
    if (rows.length === 0) {
      console.error("❌ User not found for email:", decoded.email);
      return res.status(401).json({ message: "User not found" });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    return res.status(403).json({ message: "Invalid token" });
  }
};

// Uploads directory
const uploadDir = path.join(__dirname, "Uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer config
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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

// Calculate age
function calculateAge(dob) {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const month = today.getMonth();
  if (month < birthDate.getMonth() || (month === birthDate.getMonth() && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Process image and PDF
async function processImage(filePath) {
  return await ocr({
    filePath,
    apiKey: process.env.TOGETHER_API_KEY,
  });
}

async function processPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(dataBuffer);
  if (parsed.text && parsed.text.trim().length > 0) {
    console.log("✅ PDF parsed successfully");
    return { text: parsed.text.trim(), source: "parser" };
  }
  throw new Error("Empty or invalid PDF content");
}

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    console.log("🌟 Database setup completed, starting server...");
  } catch (err) {
    console.error("🚫 Failed to initialize database, server will not start:", err.message);
    process.exit(1);
  }

  // In-memory chat storage
  const chatHistoryMap = new Map();

  // Login route
  app.post("/login", async (req, res) => {
    const { email } = req.body;
    console.log("Login attempt for email:", email);

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    try {
      const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      const user = rows[0];

      if (!user) {
        return res.status(404).json({ exists: false });
      }

      const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "24h" });
      console.log("✅ Token generated for user:", email);
      res.status(200).json({ exists: true, token, user });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Logout route (client-side only, clear token)
  app.post("/logout", (req, res) => {
    console.log("Logout requested");
    res.status(200).json({ message: "User logged out" });
  });

  // Register route
  app.post("/register", async (req, res) => {
    const { email, name, dob, healthRecords } = req.body;
    console.log("Registration attempt for email:", email);

    if (!email || !name || !dob || !healthRecords) {
      console.log("Validation failed. Missing fields:", { email, name, dob, healthRecords });
      return res.status(400).json({ message: "Email, name, date of birth, and health record are required" });
    }

    try {
      const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (rows.length > 0) {
        console.log("User with this email already exists:", email);
        return res.status(400).json({ message: "User with this email already exists" });
      }

      const age = calculateAge(dob);
      const newUser = {
        email,
        name,
        dob,
        age,
        healthRecords: [healthRecords],
        reportsCount: 0,
        scansCount: 0,
        queriesCount: 0,
      };

      await pool.query(
        `INSERT INTO users (email, name, dob, age, healthRecords, reportsCount, scansCount, queriesCount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [email, name, dob, age, `{${healthRecords}}`, 0, 0, 0]
      );

      const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "24h" });
      console.log("✅ User registered and token generated for:", email);

      res.status(201).json({ message: "User registered successfully", token, user: newUser });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Get User Data for Dashboard
  app.get("/api/user", authenticateToken, async (req, res) => {
    try {
      res.status(200).json({
        name: req.user.name,
        email: req.user.email,
        dob: req.user.dob,
        reportsCount: req.user.reportscount,
        scansCount: req.user.scanscount,
        queriesCount: req.user.queriescount,
        activities: await getUserActivities(req.user.email),
      });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Helper to get activities
  async function getUserActivities(userEmail) {
    const { rows } = await pool.query(
      "SELECT action, date FROM activities WHERE userEmail = $1 ORDER BY date DESC",
      [userEmail]
    );
    return rows;
  }

  // Record User Activity
  app.post("/api/user/activity", authenticateToken, async (req, res) => {
    const userEmail = req.user.email;
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({ message: "Activity type is required" });
    }

    try {
      let action;
      let updateQuery;

      switch (type) {
        case "labReport":
          action = "Uploaded Lab Report";
          updateQuery = "UPDATE users SET reportsCount = reportsCount + 1 WHERE email = $1";
          break;
        case "medicineScan":
          action = "Scanned Medicine";
          updateQuery = "UPDATE users SET scansCount = scansCount + 1 WHERE email = $1";
          break;
        case "aiQuery":
          action = "Asked AI Query";
          updateQuery = "UPDATE users SET queriesCount = queriesCount + 1 WHERE email = $1";
          break;
        default:
          return res.status(400).json({ message: "Invalid activity type" });
      }

      // Update counts
      await pool.query(updateQuery, [userEmail]);

      // Insert activity
      await pool.query(
        "INSERT INTO activities (userEmail, action, date) VALUES ($1, $2, $3)",
        [userEmail, action, new Date().toISOString()]
      );

      // Fetch updated user
      const { rows: updatedRows } = await pool.query("SELECT * FROM users WHERE email = $1", [userEmail]);
      const updatedUser = updatedRows[0];

      res.status(200).json({
        message: "Activity recorded",
        counts: {
          reportsCount: updatedUser.reportscount,
          scansCount: updatedUser.scanscount,
          queriesCount: updatedUser.queriescount,
        },
      });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Get All User Activities
  app.get("/api/user/activities", authenticateToken, async (req, res) => {
    try {
      const activities = await getUserActivities(req.user.email);
      res.status(200).json({ activities });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Lab Report Upload Route
  app.post("/labreport", authenticateToken, upload.single("file"), async (req, res) => {
    const start = Date.now();
    console.log("📥 Lab report upload received");

    const userEmail = req.user.email;

    if (!req.file) {
      console.error("❌ No file uploaded");
      return res.status(400).json({ message: "No file uploaded" });
    }

    const language = req.body.language || "";
    console.log("🌐 Language preference:", language);

    let client;
    try {
      const filePath = path.join(uploadDir, req.file.filename);
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      console.log("📁 Uploaded File:", {
        originalname: req.file.originalname,
        filename: req.file.filename,
        fileExt,
        filePath,
      });

      let result;
      const history = [];

      console.log("🧠 Initializing chat history...");
      if (history.length === 0) {
        history.push({
          role: "system",
          content:
            "You are a medical AI assistant. Your task is to respond to health-related queries with accurate and relevant information. If the user's question is not related to health, politely guide them to ask questions about their health data. Always provide clear, supportive, and helpful responses. If you don't have enough information to provide a clear answer, advise the user to consult a healthcare professional.",
        });
      }

      if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
        console.log("🖼 Detected image file - starting OCR...");
        const ocrText = await processImage(filePath);
        console.log("🔍 OCR Output:", ocrText.slice(0, 500));
        result = { text: ocrText, source: "ocr" };
      } else if (fileExt === ".pdf") {
        console.log("📄 Detected PDF - starting parsing...");
        try {
          const parsed = await processPDF(filePath);
          console.log("✅ Digital PDF parsed successfully");
          console.log("🔍 Parsed PDF Text:", parsed.text.slice(0, 500));
          result = { text: parsed.text.trim(), source: "parser" };
        } catch (parseError) {
          console.error("❌ PDF parsing failed:", parseError.message);
          if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            console.error("❌ PDF file is corrupted");
            return res.status(400).json({ message: "PDF file is corrupted" });
          }
          return res.status(400).json({ message: "PDF is not a parseable digital document" });
        }
      } else {
        console.error("❌ Unsupported file type:", fileExt);
        return res.status(400).json({ message: "Unsupported file type" });
      }

      console.log("🧠 Generating medical prompt...");
      const prompt = generateMedicalSummaryPrompt(result.text, language, req.user.age, req.user.healthRecords);

      history.push({ role: "user", content: prompt });

      console.log("🤖 Sending chat history to LLM...");
      const llmResponse = await sendToLLM(history);
      console.log("✅ LLM Response Received");

      // Start a transaction
      client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE users SET reportsCount = reportsCount + 1 WHERE email = $1',
          [userEmail]
        );
        await client.query(
          'INSERT INTO activities (userEmail, action, date) VALUES ($1, $2, $3)',
          [userEmail, 'Uploaded Lab Report', new Date().toISOString()]
        );
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      // Fetch updated user
      const { rows: updatedRows } = await pool.query('SELECT * FROM users WHERE email = $1', [userEmail]);
      const updatedUser = updatedRows[0];

      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`⏱️ Processing completed in ${duration}s`);

      res.status(200).json({
        message: `Processed with ${result.source}`,
        llmResponse,
        processingTime: `${duration}s`,
        counts: {
          reportsCount: updatedUser.reportscount,
          scansCount: updatedUser.scanscount,
          queriesCount: updatedUser.queriescount,
        },
      });

      // Cleanup uploaded file
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error("❌ Unexpected Processing Error:", err.message);
      res.status(500).json({ message: "Processing failed", error: err.message });
    }
  });
  
  // Medicine Upload Route
  app.post("/medicine", authenticateToken, upload.single("file"), async (req, res) => {
    const start = Date.now();
    console.log("📥 Medicine upload received");

    const userEmail = req.user.email;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const language = req.body.language || "";

    let client;
    try {
      const filePath = path.join(uploadDir, req.file.filename);
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      let result;
      const history = [];

      console.log("🧠 Initializing chat history...");
      if (history.length === 0) {
        history.push({
          role: "system",
          content:
            "You are an advanced AI assistant specialized in medical text analysis and health advisory. Your task is to process the scanned text from a medicine backstrip, extract relevant information (such as drug name, composition, dosage, and indications), and analyze it in the context of the user's past health data.",
        });
      }

      if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
        console.log("Processing Image...");
        const ocrText = await processImage(filePath);
        result = { text: ocrText, source: "ocr" };
      } else {
        console.error("❌ Unsupported file type");
        return res.status(400).json({ message: "Unsupported file type" });
      }

      console.log("🧠 Generating medicine prompt...");
      const prompt = generatemedicinesummary(result.text, language, req.user.age, req.user.healthRecords);

      history.push({ role: "user", content: prompt });

      console.log("🤖 Sending to LLM...");
      const llmResponse = await sendToLLM(history);

      // Start a transaction
      client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE users SET scansCount = scansCount + 1 WHERE email = $1',
          [userEmail]
        );
        await client.query(
          'INSERT INTO activities (userEmail, action, date) VALUES ($1, $2, $3)',
          [userEmail, 'Scanned Medicine', new Date().toISOString()]
        );
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      // Fetch updated user
      const { rows: updatedRows } = await pool.query('SELECT * FROM users WHERE email = $1', [userEmail]);
      const updatedUser = updatedRows[0];

      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`✅ Completed in ${duration}s`);

      res.status(200).json({
        message: `Processed with ${result.source}`,
        llmResponse,
        processingTime: `${duration}s`,
        counts: {
          reportsCount: updatedUser.reportscount,
          scansCount: updatedUser.scanscount,
          queriesCount: updatedUser.queriescount,
        },
      });

      // Cleanup uploaded file
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error("❌ Processing error:", err.message);
      res.status(500).json({ message: "Processing failed", error: err.message });
    }
  });

  // Chatbot Route
  // Chatbot Route
app.post("/chatbot", authenticateToken, async (req, res) => {
  let client;
  try {
    const { input } = req.body;
    const userEmail = req.user.email;

    if (!input) {
      console.error("❌ Error: Missing input in chatbot request");
      return res.status(400).json({ error: "Missing input" });
    }

    const history = chatHistoryMap.get(userEmail) || [];

    if (history.length === 0) {
      history.push({
        role: "system",
        content:
          "You are a medical AI assistant. Your task is to respond to health-related queries with accurate and relevant information. If the user's question is not related to health, politely guide them to ask questions about their health data. Always provide clear, supportive, and helpful responses. If you don't have enough information to provide a clear answer, advise the user to consult a healthcare professional.",
      });
    }

    history.push({ role: "user", content: input });

    console.log(`🤖 Sending message list to LLM for user: ${userEmail}`);
    const llmResponse = await sendToLLM(history);

    history.push({ role: "assistant", content: llmResponse });
    chatHistoryMap.set(userEmail, history);

    // Start a transaction
    client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update queriesCount
      await client.query(
        'UPDATE users SET queriesCount = queriesCount + 1 WHERE email = $1',
        [userEmail]
      );

      // Insert activity
      await client.query(
        'INSERT INTO activities (userEmail, action, date) VALUES ($1, $2, $3)',
        [userEmail, 'Asked AI Query', new Date().toISOString()]
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // Fetch updated user
    const { rows: updatedRows } = await pool.query('SELECT * FROM users WHERE email = $1', [userEmail]);
    const updatedUser = updatedRows[0];

    res.status(200).json({
      reply: llmResponse,
      counts: {
        reportsCount: updatedUser.reportscount,
        scansCount: updatedUser.scanscount,
        queriesCount: updatedUser.queriescount,
      },
    });
  } catch (err) {
    console.error("❌ Error in chatbot request:", err.message);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

  // Clear Chat History Route
  app.post("/clear-chat", authenticateToken, (req, res) => {
    const userEmail = req.user.email;

    const messageList = chatHistoryMap.get(userEmail);

    if (messageList) {
      console.log(`🔍 Chat history found for user: ${userEmail}`);
      const systemMessage = messageList[0] ? [messageList[0]] : [];
      console.log(`🧹 Clearing chat history for user: ${userEmail}`);
      console.log(`    Retained only the system message: ${systemMessage[0]?.content}`);
      chatHistoryMap.set(userEmail, systemMessage);
      console.log(`✅ Chat history cleared for user: ${userEmail}, only system message retained`);
    } else {
      console.log(`🚫 No chat history found for user: ${userEmail}`);
    }

    res.status(200).json({ message: "Chat history cleared, only system message retained" });
  });

  // Start the server
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });

  // Fallback route
  app.use((req, res) => {
    res.status(404).json({ message: "Endpoint not found" });
  });
}

// Start the server
startServer();
