const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const { ocr } = require("llama-ocr");
require("dotenv").config();

const { sendToLLM } = require("./llmHandler");
const { generateMedicalSummaryPrompt , generatemedicinesummary} = require("./promptManager");

const app = express();

const allowedOrigins = [
  "https://frontendtest-8xf8cmda1-hfuturereadys-projects.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());

// In-memory chat storage
const chatHistoryMap = new Map();
let loggedInUser = '';

// Uploads directory
const uploadDir = path.join(__dirname, "uploads");
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
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

// Dummy users data
const dummyUsers = {
  "testuser1@example.com": {
    name: "John Doe",
    dob: "1990-05-15",
    age: 35,
    healthRecords: ["Asthma", "High Blood Pressure"]
  },
  "testuser2@example.com": {
    name: "Jane Smith",
    dob: "1985-07-22",
    age: 40,
    healthRecords: ["Diabetes", "Cholesterol"]
  }
};

// Check if users.json exists and create with dummy data if not
const usersFilePath = path.join(__dirname, 'users.json');

// Function to check if the file exists, and create with dummy data if it doesn't
function checkAndCreateUsersFile() {
  if (!fs.existsSync(usersFilePath)) {
    console.log("No users file found, creating with dummy data...");
    fs.writeFileSync(usersFilePath, JSON.stringify(dummyUsers, null, 2), 'utf8');
    console.log("users.json created with dummy data.");
  }
  else{
    console.log("user file found")

  }
}

// Call the function when the server starts
checkAndCreateUsersFile();

// Function to calculate age based on Date of Birth
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

// Read users from file
function readUsersFromFile() {
  const filePath = path.join(__dirname, 'users.json');
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    console.log("Users file read successfully");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading users file:", error);
    return {}; // Return an empty object if file reading fails
  }
}

// Write users to file
function writeUsersToFile(users) {
  const filePath = path.join(__dirname, 'users.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');
    console.log("Users file written successfully");
  } catch (error) {
    console.error("Error writing to users file:", error);
  }
}

// Image OCR
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

// Login route
app.post("/login", (req, res) => {
  const { email } = req.body;

  // Validate email
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const users = readUsersFromFile();

  // Check if user exists by email
  const user = users[email];

  if (!user) {
    // If the user doesn't exist, return an error
    return res.status(404).json({ exists: false });
  }
  
  loggedInUser = email;  // Store the logged-in user's email/name temporarily
  console.log("Logged in user:", loggedInUser);  // Log the logged-in user's email/name for debugging

  // If user exists, return the data with exists: true
  res.status(200).json({ exists: true, user });
});

// logout code
app.post("/logout", (req, res) => {
  // Clear the temporary variable
  loggedInUser = '';  // Reset the temporary variable to empty string

  res.status(200).json({ message: "User logged out" });
});



// Register route
app.post("/register", (req, res) => {
  const { email, name, dob, healthRecords } = req.body;

  console.log("Registration attempt for email:", email);
  // console.log("Received body:", req.body); // Helpful log for debugging

  // Validate input
  if (!email || !name || !dob || !healthRecords) {
    console.log("Validation failed. Missing fields:", { email, name, dob, healthRecords });
    return res.status(400).json({ message: "Email, name, date of birth, and health record are required" });
  }

  const users = readUsersFromFile();

  // Check if user already exists by email
  if (users[email]) {
    console.log("User with this email already exists:", email);
    return res.status(400).json({ message: "User with this email already exists" });
  }

  // Create a new user
  const newUser = {
    name: name,
    dob: dob,
    age: calculateAge(dob),
    healthRecords: [healthRecords], // Wrap the string in a list
  };

  // Save the new user
  users[email] = newUser;
  writeUsersToFile(users);

  console.log("User registered successfully:", newUser);
  return res.status(201).json({ message: "User registered successfully", user: newUser });
});


// Lab Report Upload Route
app.post("/labreport", upload.single("file"), async (req, res) => {
  const start = Date.now();
  console.log("📥 Lab report upload received");

  if (!req.file) {
    console.error("❌ No file uploaded");
    return res.status(400).json({ message: "No file uploaded" });
  }

  const language = req.body.language || "";
  console.log("🌐 Language preference:", language);
  const users = readUsersFromFile();
  
    // Check if user exists by email
  const user = users[loggedInUser];

  const filePath = path.join(uploadDir, req.file.filename);
  const fileExt = path.extname(req.file.originalname).toLowerCase();

  console.log("📁 Uploaded File:", {
    originalname: req.file.originalname,
    filename: req.file.filename,
    fileExt,
    filePath
  });

  try {
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

    // Check if file is image or PDF
    if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
      console.log("🖼 Detected image file - starting OCR...");
      const ocrText = await processImage(filePath);
      console.log("🔍 OCR Output:", ocrText.slice(0, 500)); // Limit to avoid too much console spam
      result = { text: ocrText, source: "ocr" };
    } else if (fileExt === ".pdf") {
      console.log("📄 Detected PDF - starting parsing...");

      try {
        const parsed = await processPDF(filePath);

        if (parsed.text && parsed.text.trim().length > 0) {
          console.log("✅ Digital PDF parsed successfully");
          console.log("🔍 Parsed PDF Text:", parsed.text.slice(0, 500));
          result = { text: parsed.text.trim(), source: "parser" };
        } else {
          throw new Error("PDF is not parseable or contains no text");
        }
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
    const prompt = generateMedicalSummaryPrompt(result.text, language, user.age, user.healthRecords);
  
    history.push({
      role: "user",
      content: prompt,
    });

    // console.log("🧾 Full Chat History Length:", history.length);
    // console.log("🧾 Full Chat History:\n", JSON.stringify(history, null, 2));

    console.log("🤖 Sending chat history to LLM...");
    const llmResponse = await sendToLLM(history);
    // const llmResponse = '# Hello boss' // Sending prompt directly
    console.log("✅ LLM Response Received");

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏱️ Processing completed in ${duration}s`);

    res.status(200).json({
      message: `Processed with ${result.source}`,
      llmResponse,
      processingTime: `${duration}s`,
    });
  } catch (err) {
    console.error("❌ Unexpected Processing Error:", err.message);
    res.status(500).json({ message: "Processing failed", error: err.message });
  }
});


// Medicine Upload Route
app.post("/medicine", upload.single("file"), async (req, res) => {
  const start = Date.now();
  console.log("📥 Medicine upload received");
  const history = [];
  const language = req.body.language || ""
  const users = readUsersFromFile();
  
    // Check if user exists by email
  const user = users[loggedInUser];

  console.log("🧠 Initializing chat history...");
  if (history.length === 0) {
      history.push({
        role: "system",
        content:
          `You are an advanced AI assistant specialized in medical text analysis and health advisory. Your task is to process the scanned text from a medicine backstrip, extract relevant information (such as drug name, composition, dosage, and indications), and analyze it in the context of the user's past health data. Follow these steps
          `   });
    }

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = path.join(uploadDir, req.file.filename);
  const fileExt = path.extname(req.file.originalname).toLowerCase();

  try {
    let result;

    // Check if file is image or PDF
    if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
      console.log("Processing Image...");
      const ocrText = await processImage(filePath);
      result = { text: ocrText, source: "ocr" };
    } else {
      console.error("❌ Unsupported file type");
      return res.status(400).json({ message: "Unsupported file type" });
    }

    console.log("🧠 Generating medicine prompt...");
    const prompt = generatemedicinesummary(result.text, language, user.age, user.healthRecords);

    history.push({
      role: "user",
      content: prompt,
    });

    console.log("🤖 Sending to LLM...");
    const llmResponse = await sendToLLM(history);

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

// Chatbot Route with History
app.post("/chatbot", async (req, res) => {
  try {
    const { userId, input } = req.body;

    if (!userId || !input) {
      console.error("❌ Error: Missing userId or input in chatbot request");
      return res.status(400).json({ error: "Missing userId or input" });
    }
    // Get or init chat history
    const history = chatHistoryMap.get(userId) || [];
    
    // Push initial system message to history
    if (history.length === 0) {
      history.push({
        "role": "system",
        "content": "You are a medical AI assistant. Your task is to respond to health-related queries with accurate and relevant information. If the user's question is not related to health, politely guide them to ask questions about their health data. Always provide clear, supportive, and helpful responses. If you don't have enough information to provide a clear answer, advise the user to consult a healthcare professional."
      });
    }
    
    // Push user message to history
    history.push({ "role": "user", "content": input });

    // console.log("🧾 Full Chat History:\n", JSON.stringify(history, null, 2));
    // Send the entire message list (history) to the LLM
    console.log(`🤖 Sending message list to LLM for user: ${userId}`);
    const llmResponse = await sendToLLM(history); // Sending history directly

    // Push LLM response to history
    history.push({ "role": "assistant", "content": llmResponse });
    chatHistoryMap.set(userId, history);

    // ✅ Log the updated chat history
  
    res.status(200).json({ reply: llmResponse });
  } catch (err) {
    console.error("❌ Error in chatbot request:", err.message);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// Clear Chat History Route
app.post("/clear-chat", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    console.error("❌ Error: Missing userId in clear-chat request");
    return res.status(400).json({ error: "Missing userId" });
  }

  // Get the current message list for the user
  const messageList = chatHistoryMap.get(userId);

  if (messageList) {
    console.log(`🔍 Chat history found for user: ${userId}`);

    // Keep only the first message (system) and remove the rest
    const systemMessage = messageList[0] ? [messageList[0]] : [];
    console.log(`🧹 Clearing chat history for user: ${userId}`);
    console.log(`    Retained only the system message: ${systemMessage[0]?.content}`);

    // Update the chat history map with the reset message list
    chatHistoryMap.set(userId, systemMessage);
    console.log(`✅ Chat history cleared for user: ${userId}, only system message retained`);
  } else {
    console.log(`🚫 No chat history found for user: ${userId}`);
  }

  res.status(200).json({ message: "Chat history cleared, only system message retained" });
});

// Set up the server to listen on a port
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Fallback route
app.use((req, res) => {
  res.status(404).json({ message: "Endpoint not found" });
});
