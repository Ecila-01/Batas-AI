# Deploying Batas AI to Railway

This guide moves the two backend services off Render and onto **Railway** (Hobby plan).
The React frontend **stays on Vercel** — nothing to change there except one env var at the end.

## Architecture after migration

```
  Browser
     |
     v
  client (Vercel)  --- VITE_API_URL --->  server  (Railway service: "server")
                                            |  Node / Express, public domain
                                            |  AI_SERVICE_URL (private)
                                            v
                                          ai-service (Railway service: "ai-service")
                                            FastAPI / uvicorn, PRIVATE only (no public domain)

  External SaaS (unchanged, just copy env vars):
    MongoDB Atlas · Cloudinary · Qdrant Cloud · Google Gemini
```

You will create **one Railway project** containing **two services**, both pointing at the
same GitHub repo (`Ecila-01/Batas-AI`) but at different root directories.
Both folders already have a working `Dockerfile`, so Railway builds them automatically.

---

## Step 0 — Push these config files first

This repo now contains `server/railway.json` and `ai_service/railway.json` (added for you).
Make sure they're pushed to GitHub before you start:

```bash
git add server/railway.json ai_service/railway.json RAILWAY_DEPLOY.md
git commit -m "Add Railway config"
git push
```

---

## Step 1 — Create the project + the Node service

1. Go to https://railway.com → **New Project** → **Deploy from GitHub repo**.
2. Pick `Ecila-01/Batas-AI`. Railway creates the project and a first service.
3. Open that service → **Settings**:
   - **Service name:** `server`
   - **Root Directory:** `server`
   - **Config-as-code / Railway Config File path:** `server/railway.json`
     (Railway does *not* infer the config file from the root directory — give it the full path.)
   - Build method will auto-select **Dockerfile** (because `server/Dockerfile` exists).

> Don't deploy yet — set the variables first (Step 3), or it'll fail and just redeploy after.

## Step 2 — Add the Python service to the SAME project

1. Inside the project, click **New** → **GitHub Repo** → pick `Ecila-01/Batas-AI` again.
2. Open the new service → **Settings**:
   - **Service name:** `ai-service`   ← use this exact name; it becomes the private hostname
   - **Root Directory:** `ai_service`
   - **Config-as-code path:** `ai_service/railway.json`
   - Build method auto-selects **Dockerfile**.
3. This service stays **private** — do NOT generate a public domain for it.

---

## Step 3 — Environment variables

Set these under each service's **Variables** tab. (Same values you used on Render.)

### `server` service
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | your MongoDB Atlas connection string |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary |
| `CLOUDINARY_API_KEY` | from Cloudinary |
| `CLOUDINARY_API_SECRET` | from Cloudinary |
| `CLIENT_URL` | your Vercel URL, e.g. `https://batas-ai.vercel.app` |
| `AI_SERVICE_URL` | `http://ai-service.railway.internal:8000` |

Notes:
- **Do NOT set `PORT`.** Railway injects it and `server.js` already reads `process.env.PORT`.
- `AI_SERVICE_URL` uses Railway's **private network** (`<service-name>.railway.internal`).
  Port `8000` is the port the FastAPI container listens on. No public exposure, no egress cost.
- `HOST` isn't needed — the code uses `0.0.0.0` automatically when `NODE_ENV=production`.

### `ai-service` service
| Variable | Value |
|---|---|
| `GOOGLE_API_KEY` | your Gemini API key |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary |
| `CLOUDINARY_API_KEY` | from Cloudinary |
| `CLOUDINARY_API_SECRET` | from Cloudinary |
| `QDRANT_URL` | your Qdrant Cloud URL |
| `QDRANT_API_KEY` | your Qdrant Cloud key |

---

## Step 4 — Give the Node service a public URL

1. Open the **`server`** service → **Settings → Networking → Public Networking**.
2. Click **Generate Domain**. Railway exposes the port from `$PORT` automatically.
3. Copy the URL, e.g. `https://server-production-xxxx.up.railway.app`.

## Step 5 — Deploy

Trigger a deploy on both services (push a commit, or **Deploy** in the dashboard).
Watch the build logs. Expected:
- `ai-service`: builds the Python image (installs Tesseract + deps), then `uvicorn` starts on `:8000`.
- `server`: builds Node image, connects to MongoDB, logs `🔗 AI Service URL: http://ai-service.railway.internal:8000`.

Quick check: open `https://<your-server-domain>/` (or the health route) and confirm it responds.

---

## Step 6 — Point the frontend at Railway (Vercel)

1. Vercel → your project → **Settings → Environment Variables**.
2. Set **`VITE_API_URL`** = your Railway `server` public URL (from Step 4), no trailing slash.
3. **Redeploy** the frontend (Vite bakes env vars in at build time, so a redeploy is required).
4. Back on Railway, make sure the `server` variable **`CLIENT_URL`** equals your exact Vercel
   domain — `server.js` uses it for CORS, so a mismatch will block the browser.

---

## Step 7 — Decommission Render

Once the Railway URLs work end-to-end (upload a doc, ask a question), delete or suspend the two
Render services so they stop building. Keep MongoDB Atlas, Qdrant, and Cloudinary as-is.

---

## Gotchas / FAQ

- **Do I separate Node and Python again?** Yes — they remain two separate *services*, but now in
  **one project** sharing a private network, one dashboard, and one bill. Much less fragmented than
  Vercel + two Render services.
- **Private call fails / ECONNREFUSED:** the hostname is case-sensitive and must match the service
  name exactly (`ai-service.railway.internal`). Also confirm the AI service listens on `0.0.0.0`
  (it does) and on port `8000` (it does).
- **Cold starts:** Railway doesn't sleep services the way Render's free tier did, so the first-request
  delay you had on free Render goes away.
- **Cost:** Hobby includes ~$5 of usage credit/month; two small always-on services typically fit
  inside or just above that. Watch the project's **Usage** tab.
- **Lockfiles:** your root `.gitignore` ignores `package-lock.json`. Builds still work (Docker runs
  `npm install`), but committing the lockfile would make builds reproducible if you want that later.
