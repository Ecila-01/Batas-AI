require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// CLOUDINARY STORAGE IMPORTS
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
let isSystemInitializing = true;

const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

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
            const cleanName = file.originalname
                .replace(/\.pdf$/i, '')
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_\-]/g, '')
            return cleanName;
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
// 3. HELPER: Poll Python service until ready
// ==========================================
async function waitForAiService() {
    console.log("⏳ Waiting for AI service to be ready...");
    while (true) {
        try {
            const res = await fetch(`${AI_SERVICE_URL}/health`);
            if (res.ok) {
                console.log("✅ AI service is ready!");
                return;
            }
        } catch (e) {
            // Still starting up
        }
        await new Promise(r => setTimeout(r, 3000)); // Retry every 3s
    }
}

// ==========================================
// 4. API ENDPOINTS
// ==========================================

// Fetch the active AI Model from Python service
app.get('/api/model', async (req, res) => {
    try {
        const response = await fetch(`${AI_SERVICE_URL}/model`);
        const data = await response.json();
        res.json({ model: data.model || 'Unknown Model', isInitializing: isSystemInitializing });
    } catch (error) {
        res.json({ model: 'Unknown Model', isInitializing: isSystemInitializing });
    }
});

// Ping Endpoint to keep the free server awake!
app.get('/api/ping', (req, res) => {
    res.status(200).send("pong");
});

// Production Cloudinary Upload Route
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded or invalid file type." });
    }

    const cloudinaryUrl = req.file.path;
    console.log(`\n☁️ File securely hosted on Cloudinary: ${cloudinaryUrl}`);
    console.log("⚙️ Triggering AI Data Ingestion via Python service...");

    try {
        // Fire and forget — Python service handles ingestion in background
        fetch(`${AI_SERVICE_URL}/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cloudinaryUrl })
        }).catch(err => console.error('❌ Ingest request failed:', err));

        res.json({
            message: "File uploaded and AI brain updated successfully!",
            filename: req.file.originalname,
            url: cloudinaryUrl
        });
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ error: "Failed to trigger ingestion." });
    }
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
app.post('/api/ask', async (req, res) => {
    if (isSystemInitializing) {
        return res.status(503).json({
            answer: "Batas AI is currently initializing the database from the cloud. Please wait about 2 minutes and try asking again!",
            sources: []
        });
    }

    const { question: userQuestion, sessionId } = req.body;

    if (!userQuestion || !sessionId) {
        return res.status(400).json({ error: "Missing question or session ID" });
    }

    console.log(`\nUser [${sessionId}] asked: "${userQuestion}"`);
    console.log("Forwarding to AI service...");

    try {
        const aiResponse = await fetch(`${AI_SERVICE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userQuestion })
        });

        const data = await aiResponse.json();
        const finalAnswer = data.answer || "I couldn't generate a response.";
        const sources = data.sources || [];

        console.log("✅ Successfully generated response!");

        // Save to MongoDB
        try {
            const newChat = new Chat({
                sessionId: sessionId,
                question: userQuestion,
                answer: finalAnswer
            });
            await newChat.save();
            console.log("💾 Chat successfully saved to database!");
        } catch (dbError) {
            console.error("❌ Failed to save chat to DB:", dbError);
        }

        res.json({ answer: finalAnswer, sources: sources });

    } catch (error) {
        console.error('❌ AI service error:', error);
        res.status(500).json({
            answer: "Error: Cannot reach the AI service. Please try again.",
            sources: []
        });
    }
});

// ==========================================
// 5. PRODUCTION-READY NETWORK BINDINGS
// ==========================================
const PORT = process.env.PORT || 5000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

app.listen(PORT, HOST, async () => {
    const displayHost = HOST === '0.0.0.0' ? 'Cloud Environment' : HOST;
    console.log(`🚀 Batas API Server is live at http://${displayHost}:${PORT}`);
    console.log(`🔗 AI Service URL: ${AI_SERVICE_URL}`);

    // Wait for Python service to finish its startup sync
    await waitForAiService();
    isSystemInitializing = false;
    console.log("⚡ [SYSTEM READY]: AI service confirmed ready. Batas is now unlocked!");
});