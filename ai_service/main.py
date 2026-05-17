from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
import uvicorn
from bulk_ingest import add_single_document, run_master_sync
from chat import ask_batas_api, ACTIVE_MODEL
import threading

app = FastAPI()

class AskRequest(BaseModel):
    question: str

class IngestRequest(BaseModel):
    url: str

# 1. FIXED: Render requires a valid root path check to properly map public routing
@app.get("/")
def read_root():
    return {
        "status": "ok", 
        "service": "batas-ai-python-microservice",
        "active_model": ACTIVE_MODEL
    }

# 2. FIXED: Standardized application tracking health check
@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/chat")
def chat(req: AskRequest):
    result = ask_batas_api(req.question)
    return result

# 3. UPGRADE: Replaced manual threading with FastAPI native BackgroundTasks 
# to ensure cleaner memory recycling and prevent request thread leaks on Render.
@app.post("/ingest")
def ingest(req: IngestRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(add_single_document, req.url)
    return {"status": "ingestion started"}

@app.get("/model")
def get_model():
    return {"model": ACTIVE_MODEL}

# 4. LIFECYCLE: Executes the master database validation instantly upon boot
@app.on_event("startup")
async def startup_event():
    thread = threading.Thread(target=run_master_sync)
    thread.daemon = True
    thread.start()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
