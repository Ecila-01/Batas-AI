from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
from bulk_ingest import add_single_document, run_master_sync
from chat import ask_batas_api
import threading

app = FastAPI()

class AskRequest(BaseModel):
    question: str

class IngestRequest(BaseModel):
    url: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/chat")
def chat(req: AskRequest):
    result = ask_batas_api(req.question)
    return result

@app.post("/ingest")
def ingest(req: IngestRequest):
    # Run in background so HTTP response returns immediately
    thread = threading.Thread(target=add_single_document, args=(req.url,))
    thread.start()
    return {"status": "ingestion started"}

@app.get("/model")
def get_model():
    from chat import ACTIVE_MODEL
    return {"model": ACTIVE_MODEL}

# Run master sync on startup in background
@app.on_event("startup")
async def startup_event():
    thread = threading.Thread(target=run_master_sync)
    thread.daemon = True
    thread.start()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
