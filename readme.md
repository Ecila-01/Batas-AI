# Batas AI — Intelligent Ordinance Analysis Platform

Batas AI is a Retrieval-Augmented Generation (RAG) platform built to index, search, and
analyze local government ordinances and legal documents from any Philippine municipality.
Users upload PDF ordinances and query them through a conversational interface that answers
strictly from the source text and cites every claim back to the exact document and page.

---

## System Architecture

The platform decouples the vector database from the runtime container entirely, eliminating
memory bottlenecks and keeping the service available even on free-tier cloud infrastructure.

```
[ React Frontend (Vercel) ]
        |
        |-- POST /api/ask ----------------------------------------------------------------+
        |                                                                                 |
        +-- POST /api/upload --> [ Cloudinary CDN ] --> [ Express Backend (Render) ] --> [ Python AI Service ]
                                   (Raw PDF Store)              |                              |
                                                               |                              |
                                                               v                              v
                                                    [ Node.js API Server ]        [ LangChain RAG Pipeline ]
                                                               |                              |
                                                    [ MongoDB Atlas ]     +-------------------+
                                                    (history + sources)   |                   |
                                                                [ Tesseract OCR ]     [ Gemini Embeddings ]
                                                                (scanned PDF fallback)         |
                                                                                               v
                                                                                    [ Qdrant Cloud (persistent) ]
                                                                                    (3072-d vector index)
```

---

## Tech Stack

| Layer            | Technology                                             |
|------------------|--------------------------------------------------------|
| Frontend         | React + Vite (with react-markdown), deployed on Vercel |
| Backend          | Node.js + Express, deployed on Render                  |
| AI Pipeline      | Python, LangChain, Google Gemini                      |
| Embedding model  | `gemini-embedding-2` (3072 dimensions)                |
| Generation model | `gemini-2.0-flash` with optional Groq / OpenRouter / GitHub Models fallback |
| Vector database  | Qdrant Cloud (persistent, free tier)                  |
| Document storage | Cloudinary (raw PDF hosting)                          |
| Chat history     | MongoDB Atlas (TTL: 24 hours)                         |
| OCR fallback     | Tesseract via PyMuPDF + Pillow                        |

### Two models, one caveat

The pipeline uses two independent models. The **embedding model** converts text into the
vectors stored in Qdrant and runs during both ingestion and every query; changing it makes
the existing 3072-d vectors incompatible and requires re-ingesting every document. The
**generation model** only reads retrieved text and writes the answer, so it can be swapped
freely (for example to a cheaper model or another provider) without re-ingestion.
Anthropic does not offer an embedding model, so a Claude model could serve as the generation
model but not the embedding model; use Voyage AI if you want to move embeddings off Gemini.

### Generation fallback chain

Because free tiers impose daily request quotas, the generation step uses a **multi-provider
fallback chain** instead of a single model. On each request it tries the configured providers
in order and falls back to the next one on any rate-limit or error, so a single provider
running out of free quota no longer takes the app down.

The order is by model quality, strongest first: OpenRouter (DeepSeek V3) as the core, then
GitHub Models (GPT-5-mini), then Groq (Llama 3.3 70B), then Gemini (Gemini is last both on
quality and because its free-tier generation quota can drop to zero on some projects). A
provider is included only if its API key is set, so the chain adapts to whatever free keys
are available. All of these are free tiers with no credit card. Model ids are overridable via
env vars (`OPENROUTER_MODEL`, `GITHUB_MODEL`, `GROQ_MODEL`, `GEMINI_MODEL`) so a deprecated id
can be fixed without code changes. Embeddings always stay on Gemini.

| Priority | Provider | Env key | Default model | Get a free key |
|----------|----------|---------|---------------|----------------|
| 1 (core) | OpenRouter | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat-v3-0324:free` | https://openrouter.ai/keys |
| 2 | GitHub Models | `GITHUB_TOKEN` | `openai/gpt-5-mini` | https://github.com/settings/tokens (fine-grained, `models:read`) |
| 3 | Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | https://console.groq.com/keys |
| 4 | Google Gemini | `GOOGLE_API_KEY` | `gemini-2.0-flash` | https://aistudio.google.com/apikey |

---

## Key Features

- **Universal ordinance support** — upload PDFs from any Philippine municipality, not limited to one city.
- **Scanned PDF support** — image-based PDFs are detected automatically and passed through Tesseract OCR.
- **Persistent vector storage** — Qdrant Cloud keeps the index intact across container restarts, avoiding costly re-ingestion on every deploy.
- **Smart startup sync** — on boot the service checks whether Qdrant already has data and skips re-ingestion entirely for near-instant startup.
- **Ordinance-aware retrieval** — when a query names a specific ordinance number, chunks from matching source documents are prioritized.
- **Inline per-claim citations** — retrieved chunks are numbered, the model cites them inline with `[n]` markers where it uses each one, and the response returns only the sources actually cited, each with a document title and page number.
- **Source reader panel** — clicking a citation opens the cited passage and the original PDF, scrolled to the referenced page, alongside the conversation.
- **Markdown answers** — responses render as structured Markdown (headings, lists, tables, emphasis) rather than plain text.
- **Citation-preserving history** — conversations and their sources persist for 24 hours in MongoDB, so reopening a session restores the citations too.
- **Light and dark themes** — a theme toggle with a warm, credibility-focused visual system.
- **OCR-tolerant prompting** — the model is instructed to interpret minor OCR artifacts intelligently rather than refusing to answer.

---

## How It Works

### Startup sync

When the server boots it starts a Python background task that checks Qdrant for existing
vectors. If the collection is empty (first deploy), it downloads every PDF from Cloudinary,
runs OCR where needed, chunks the text, embeds each chunk with Gemini, and uploads everything
to Qdrant. On subsequent restarts this step is skipped.

### Document upload

When a user uploads a PDF, the file is stored on Cloudinary first. The backend then asks the
Python service to ingest the Cloudinary URL: it downloads, OCRs, chunks, embeds, and appends
the new vectors directly into the existing Qdrant collection — no full re-ingestion. Each
chunk is tagged with its source filename, a clean document title, its page number, and the
PDF URL so citations can point back precisely.

### Query pipeline

1. The user question is sent to `/api/ask` and forwarded to the Python `/chat` endpoint.
2. The question is embedded with `gemini-embedding-2`.
3. Qdrant returns the most similar chunks (retrieves `k = 15`, keeps the top `8` as citable sources).
4. If the question names a specific ordinance number, matching chunks are prioritized.
5. The retained chunks are presented to the generation model (the first available provider in the fallback chain) as a numbered source list, and the model is instructed to answer only from that text and to cite each claim inline with `[n]`.
6. The service parses which `[n]` markers the model actually used, renumbers them cleanly, de-duplicates by document and page, and returns the answer plus the matching source metadata (title, page, URL, and a short cited passage).
7. The frontend renders the Markdown answer, turns each `[n]` into a clickable citation, and lists the sources below the answer. The Node server also saves the answer and its sources to MongoDB.

There is no "used context" tag or single-source limitation; the sources shown are exactly the
ones the model referenced.

---

## Project Structure

```
Batas/
├── ai_service/              # Python RAG pipeline
│   ├── bulk_ingest.py       # PDF ingestion + Qdrant sync (metadata tagging)
│   ├── chat.py              # Query handler + inline-citation pipeline
│   ├── main.py              # FastAPI app
│   ├── requirements.txt
│   └── .env example
├── client/                  # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── App.jsx          # Workspace UI, markdown + citation rendering, source panel
│   │   ├── App.css          # Workspace layout and component styles
│   │   └── index.css        # Design tokens (light/dark)
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── .env example
├── server/                  # Node.js Express backend
│   ├── server.js            # API + Mongo schema (question, answer, sources)
│   ├── migrate.js
│   └── package.json
├── readme.md
└── Dockerfile               # Unified container build
```

---

## Local Development

Install and run each service from its own directory.

```bash
# AI service
cd ai_service
pip install -r requirements.txt
uvicorn main:app --reload

# Backend
cd server
npm install
node server.js

# Frontend (note: react-markdown and remark-gfm are new dependencies)
cd client
npm install
npm run dev
```

---

## Environment Variables

### `ai_service/.env`

```env
GOOGLE_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
QDRANT_URL=
QDRANT_API_KEY=

# Optional generation-fallback providers (all free tiers). Set any you want in
# the chain; the app uses whichever keys are present.
GROQ_API_KEY=
OPENROUTER_API_KEY=
GITHUB_TOKEN=
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

---

## Docker Deployment

The project ships with a single Dockerfile that installs both the Python runtime (with
Tesseract OCR) and the Node.js runtime in one container, targeting Render's free tier.

```bash
docker build -t batas-ai .
docker run -p 5000:5000 --env-file server/.env batas-ai
```

---

## Free Tier Considerations

| Service       | Limit                                    | Notes                                         |
|---------------|------------------------------------------|-----------------------------------------------|
| Render        | 512MB RAM, spins down after 15 min idle  | Ping endpoint keeps it alive                  |
| Qdrant Cloud  | 1GB storage, 1 free cluster              | Persistent across restarts                    |
| Google Gemini | Free tier, no card (`gemini-2.0-flash`)   | Roughly 1,500 requests/day; same `GOOGLE_API_KEY` for chat and embeddings |
| MongoDB Atlas | 512MB free                               | Chat TTL set to 24 hours to manage storage    |
| Cloudinary    | 25GB storage, 25GB bandwidth/month       | Raw PDF hosting                               |
