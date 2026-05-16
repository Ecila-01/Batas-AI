require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose'); // NEW: Import mongoose

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
    // NEW: MongoDB will automatically delete this document 24 hours (86400 seconds) after it is created!
    createdAt: { type: Date, default: Date.now, expires: 86400 } 
});

// Create the model
const Chat = mongoose.model('Chat', chatSchema);

// ==========================================
// 2. MULTER CONFIGURATION (Local MVP)
// ==========================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../ai_service/ordinances');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
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
// 3. API ENDPOINTS
// ==========================================



// NEW: Fetch the active AI Model from Python
app.get('/api/model', (req, res) => {
    const pythonProcess = spawn('.venv/Scripts/python.exe', ['-u', 'chat.py', '--get-model'], {
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

// NEW: Ping Endpoint to keep the free server awake!
app.get('/api/ping', (req, res) => {
    res.status(200).send("pong");
});

// File Upload Route
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded or invalid file type." });
    }

    console.log(`\n📥 Received new file: ${req.file.originalname}`);
    console.log("⚙️ Triggering AI Data Ingestion...");

    const pythonProcess = spawn('.venv/Scripts/python.exe', ['-u', 'bulk_ingest.py'], {
        cwd: path.join(__dirname, '../ai_service') 
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Ingest Output]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.log(`[Ingest Status]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log("✅ AI successfully absorbed the new document!");
        res.json({ 
            message: "File uploaded and AI brain updated successfully!",
            filename: req.file.originalname
        });
    });
});

//Fetch Chat History Route
app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        // Find all chats with this session ID and sort them by oldest to newest (timestamp: 1)
        const history = await Chat.find({ sessionId: sessionId }).sort({ timestamp: 1 });
        res.json(history);
    } catch (error) {
        console.error("❌ Error fetching history:", error);
        res.status(500).json({ error: "Failed to load history" });
    }
});

//delete
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
    // Grab both the question and the sessionId from the frontend
    const { question: userQuestion, sessionId } = req.body;

    if (!userQuestion || !sessionId) {
        return res.status(400).json({ error: "Missing question or session ID" });
    }

    console.log(`\nUser [${sessionId}] asked: "${userQuestion}"`);
    console.log("Waking up Batas AI...");

    const pythonProcess = spawn('.venv/Scripts/python.exe', ['-u', 'chat.py', userQuestion], {
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

        // Save the conversation to MongoDB attached to this specific user
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