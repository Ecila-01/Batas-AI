require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose');

// CLOUDINARY STORAGE IMPORTS
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
app.use(cors({ origin: clientOrigin }));
app.use(express.json());

// ==========================================
// 1. MONGODB CONFIGURATION & SCHEMA
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const chatSchema = new mongoose.Schema({
    sessionId: String,
    question: String,
    answer: String,
    createdAt: { type: Date, default: Date.now, expires: 86400 } 
});

// Create the model
const Chat = mongoose.model('Chat', chatSchema);

// ==========================================
// 2. CLOUDINARY & MULTER CONFIGURATION
// ==========================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'Batas', 
    format: async (req, file) => 'pdf', 
    public_id: (req, file) => {
        const cleanName = file.originalname.split('.')[0].replace(/\s+/g, '_');
        return `${cleanName}-${Date.now()}`;
    },
    resource_type: 'raw' 
  },
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// ==========================================
// ENVIRONMENT AWARE PYTHON EXECUTABLE BINDING
// ==========================================
// Uses the global Linux executable 'python3' when on Render, falls back to local virtual env for Windows development
const PYTHON_CMD = process.env.NODE_ENV === 'production' ? 'python3' : '.venv/Scripts/python.exe';

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Fetch the active AI Model from Python
app.get('/api/model', (req, res) => {
    const pythonProcess = spawn(PYTHON_CMD, ['-u', 'chat.py', '--get-model'], {
        cwd: path.join(__dirname, '../ai_service') 
    });

    let modelName = '';

    pythonProcess.stdout.on('data', (data) => {
        modelName += data.toString();
    });

    pythonProcess.on('close', () => {
        res.json({ model: modelName.trim() || 'Unknown Model' });
    });
});

// Ping Endpoint to keep the free server awake!
app.get('/api/ping', (req, res) => {
    res.status(200).send("pong");
});

// Production Cloudinary Upload Route
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded or invalid file type." });
    }

    const cloudinaryUrl = req.file.path; 
    console.log(`\n☁️ File securely hosted on Cloudinary: ${cloudinaryUrl}`);
    console.log("⚙️ Triggering AI Data Ingestion via Remote Stream Address...");

    // Spawning data ingestion script passing down environmental keys dynamically
    const pythonProcess = spawn(PYTHON_CMD, ['-u', 'bulk_ingest.py', '--url', cloudinaryUrl], {
        cwd: path.join(__dirname, '../ai_service'),
        env: {
            ...process.env,
            CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
            CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
            CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME
        }
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Ingest Output]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.log(`[Ingest Status]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log("✅ AI successfully absorbed the new cloud document!");
        res.json({ 
            message: "File uploaded and AI brain updated successfully!",
            filename: req.file.originalname,
            url: cloudinaryUrl
        });
    });
});

// Fetch Chat History Route
app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const history = await Chat.find({ sessionId: sessionId }).sort({ timestamp: 1 });
        res.json(history);
    } catch (error) {
        console.error("❌ Error fetching history:", error);
        res.status(500).json({ error: "Failed to load history" });
    }
});

// Delete History
app.delete('/api/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await Chat.deleteMany({ sessionId: sessionId });
        console.log(`🗑️ Cleared history for session: ${sessionId}`);
        res.json({ message: "History cleared successfully" });
    } catch (error) {
        console.error("❌ Error clearing history:", error);
        res.status(500).json({ error: "Failed to clear history" });
    }
});

// Chat Route 
app.post('/api/ask', (req, res) => {
    const { question: userQuestion, sessionId } = req.body;

    if (!userQuestion || !sessionId) {
        return res.status(400).json({ error: "Missing question or session ID" });
    }

    console.log(`\nUser [${sessionId}] asked: "${userQuestion}"`);
    console.log("Waking up Batas AI...");

    const pythonProcess = spawn(PYTHON_CMD, ['-u', 'chat.py', userQuestion], {
        cwd: path.join(__dirname, '../ai_service') 
    });

    let aiAnswer = '';

    pythonProcess.stdout.on('data', (data) => {
        aiAnswer += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        console.log(`[Python Status]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', async (code) => {
        console.log("Successfully generated response!");
        const finalAnswer = aiAnswer.trim();

        try {
            const newChat = new Chat ({
                sessionId: sessionId,
                question: userQuestion,
                answer: finalAnswer
            });
            await newChat.save();
            console.log("💾 Chat successfully saved to database!");
        } catch (dbError) {
            console.error("❌ Failed to save chat to DB:", dbError);
        }

        res.json({ answer: finalAnswer });
    });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || 'localhost';

app.listen(PORT, () => {
    const serverUrl = process.env.NODE_ENV === 'production' 
        ? `https://${HOST}` 
        : `http://${HOST}:${PORT}`;
    console.log(`Batas API is running on ${serverUrl}`);
});