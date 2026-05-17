# ⚖️ Batas AI — Intelligent Ordinance Analysis Platform

Batas AI is a production-ready **Retrieval-Augmented Generation (RAG)** platform built to index, search, and intelligently analyze local government ordinances and legal documents from any Philippine municipality. Users can upload their own PDF ordinances and query them instantly through a conversational AI interface.

-----

## 🏗️ System Architecture

The platform decouples the vector database from the runtime container entirely, eliminating memory bottlenecks and ensuring high availability even on free-tier cloud infrastructure.

```
[ React Frontend (Vercel) ]
        │
        ├── POST /api/ask ──────────────────────────────────────────────────────────────────┐
        │                                                                                   │
        └── POST /api/upload ──> [ Cloudinary CDN ] ──> [ Express Backend (Render) ] ──> [ Python Subprocess ]
                                   (Raw PDF Store)              │                               │
                                                                │ spawn()                       │
                                                                ▼                               ▼
                                                     [ Node.js API Server ]         [ LangChain RAG Pipeline ]
                                                                                               │
                                                                    ┌──────────────────────────┤
                                                                    │                          │
                                                          [ Tesseract OCR ]         [ Gemini Embeddings ]
                                                          (Scanned PDF Fallback)               │
                                                                                               ▼
                                                                                    [ Qdrant Cloud (Persistent) ]
                                                                                    (3072-d Vector Index)
```

-----

## 🧰 Tech Stack

|Layer           |Technology                            |
|----------------|--------------------------------------|
|Frontend        |React + Vite, deployed on Vercel      |
|Backend         |Node.js + Express, deployed on Render |
|AI Pipeline     |Python, LangChain, Google Gemini      |
|Embeddings      |`gemini-embedding-2` (3072 dimensions)|
|LLM             |`gemini-2.5-flash`                    |
|Vector Database |Qdrant Cloud (persistent, free tier)  |
|Document Storage|Cloudinary (raw PDF hosting)          |
|Chat History    |MongoDB Atlas (TTL: 24 hours)         |
|OCR Fallback    |Tesseract via PyMuPDF + Pillow        |

-----

## ✨ Key Features

- **Universal Ordinance Support** — Upload PDFs from any Philippine municipality, not limited to a single city
- **Scanned PDF Support** — Automatically detects image-based PDFs and falls back to Tesseract OCR for text extraction
- **Persistent Vector Storage** — Qdrant Cloud keeps the vector index intact across container restarts, eliminating costly re-ingestion on every deploy
- **Smart Startup Sync** — On boot, checks if Qdrant already has data and skips re-ingestion entirely for near-instant startup
- **Ordinance-Aware Retrieval** — Detects ordinance numbers in user queries and prioritizes chunks from matching source documents
- **Real Source Citations** — Responses include clickable citation chips linking back to the original PDF on Cloudinary
- **Session Chat History** — Conversations persist for 24 hours via MongoDB Atlas with per-session isolation
- **OCR-Tolerant Prompting** — LLM is instructed to interpret minor OCR artifacts intelligently rather than refusing to answer

-----

## 🚀 How It Works

### Startup Sync

When the server boots, it spawns a Python background process that checks Qdrant for existing vectors. If the collection is empty (first deploy), it downloads all PDFs from Cloudinary, runs OCR if needed, chunks the text, embeds each chunk via Gemini, and uploads everything to Qdrant. On subsequent restarts, this step is skipped entirely.

### Document Upload

When a user uploads a PDF through the UI, the file is uploaded to Cloudinary first. The backend then spawns a Python subprocess with the Cloudinary URL, which downloads, OCRs, chunks, embeds, and appends the new vectors directly into the existing Qdrant collection — no full re-ingestion required.

### Query Pipeline

1. User question is sent to `/api/ask`
1. Python subprocess embeds the question using `gemini-embedding-2`
1. Qdrant performs a similarity search across all stored chunks (`k=6`)
1. If the question mentions a specific ordinance number, matching chunks are prioritized
1. Retrieved context is passed to `gemini-2.5-flash` with a structured prompt
1. Response and source metadata are returned as JSON and rendered in the chat UI

-----

## 🗂️ Project Structure

```
Batas/
├── ai_service/              # Python RAG pipeline
│   ├── bulk_ingest.py       # PDF ingestion + Qdrant sync
│   ├── chat.py              # Query handler
│   ├── requirements.txt
│   ├── .env example
│   └── .gitignore
├── client/                  # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   └── App.css
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── .env example
│   └── .gitignore
├── server/                  # Node.js Express backend
│   ├── server.js
│   ├── migrate.js
│   ├── package.json
│   └── .env example
├── .gitignore
└── Dockerfile               # Unified container build
```

-----

## ⚙️ Environment Variables

### `ai_service/.env`

```env
GOOGLE_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
QDRANT_URL=
QDRANT_API_KEY=
```

### `client/.env`

```env
VITE_API_URL=
```

### `server/.env`

```env
MONGO_URI=
CLIENT_URL=
PORT=5000
NODE_ENV=development
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
QDRANT_URL=
QDRANT_API_KEY=
GOOGLE_API_KEY=
```

-----

## 🐳 Docker Deployment

The project ships with a single `Dockerfile` that installs both the Python (with Tesseract OCR) and Node.js runtimes in one container, targeting Render’s free tier.

```bash
docker build -t batas-ai .
docker run -p 5000:5000 --env-file server/.env batas-ai
```

-----

## ⚠️ Free Tier Considerations

|Service      |Limit                                 |Notes                                        |
|-------------|--------------------------------------|---------------------------------------------|
|Render       |512MB RAM, spins down after 15min idle|Ping endpoint keeps it alive                 |
|Qdrant Cloud |1GB storage, 1 free cluster           |Persistent across restarts                   |
|Google Gemini|~20 req/day (2.5-flash free tier)     |Use `gemini-2.0-flash-lite` for higher limits|
|MongoDB Atlas|512MB free                            |Chat TTL set to 24 hours to manage storage   |
|Cloudinary   |25GB storage, 25GB bandwidth/month    |Raw PDF hosting                              |