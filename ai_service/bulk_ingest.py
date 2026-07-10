import os
import requests
import argparse
import cloudinary
import cloudinary.api
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
import fitz
import pytesseract
from PIL import Image
from langchain_core.documents import Document
import sys
import io
import gc
import re
import time

load_dotenv()


def safe_remove(path):
    """Best-effort temp-file cleanup. On Windows PyMuPDF can hold the file handle
    briefly after processing, so a naive os.remove raises WinError 32. Retry with
    a gc pass, and never let cleanup failure abort a document that already
    ingested successfully."""
    for _ in range(4):
        try:
            if os.path.exists(path):
                os.remove(path)
            return
        except Exception:
            gc.collect()
            time.sleep(0.25)


def derive_title(source: str) -> str:
    """Human-readable document title from a raw PDF filename.

    Kept in sync with ai_service/chat.py so citations render consistently.
    """
    if not source:
        return "Unknown document"
    base = re.sub(r"\.pdf$", "", source, flags=re.IGNORECASE)
    base = base.replace("_", " ").replace("-", " ")
    base = re.sub(r"\s+", " ", base).strip()
    return base or source


def tag_chunk_metadata(chunk, source_name, url):
    """Attach source, url, a clean title, and a 1-safe integer page to a chunk."""
    chunk.metadata['source'] = source_name
    chunk.metadata['url'] = url
    chunk.metadata['title'] = derive_title(source_name)
    page = chunk.metadata.get('page')
    if page is not None:
        try:
            chunk.metadata['page'] = int(page)
        except (TypeError, ValueError):
            pass
    return chunk

if sys.platform == 'win32':
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
else:
    pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-2",
    google_api_key=os.getenv("GOOGLE_API_KEY")
)

COLLECTION_NAME = "Batas"
VECTOR_SIZE = 3072  # gemini-embedding-2 output dimension

def get_qdrant_client():
    return QdrantClient(
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY")
    )

def ensure_collection_exists(client):
    """Create the Qdrant collection if it doesn't already exist."""
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        print(f"📦 Collection '{COLLECTION_NAME}' not found. Creating it...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE)
        )
        print(f"✅ Collection '{COLLECTION_NAME}' created!")
    else:
        print(f"✅ Collection '{COLLECTION_NAME}' already exists.")

def process_and_split_pdf(file_path):
    """Extract text with an intelligent page-by-page OCR fallback."""
    loader = PyMuPDFLoader(file_path)
    docs = loader.load()
    
    pdf_document = fitz.open(file_path)

    for i, doc in enumerate(docs):
        # A standard legal page has 1500+ characters. 
        # If PyMuPDF extracts less than 800, it's likely a scan hiding an image layer.
        if len(doc.page_content.strip()) < 800:
            print(f"📸 Page {i + 1} has suspiciously low text count. Forcing Tesseract OCR...")
            page = pdf_document.load_page(i)
            # 300 DPI + Grayscale drastically improves Tesseract's reading accuracy
            pix = page.get_pixmap(dpi=300, colorspace=fitz.csGRAY)
            img_bytes = pix.tobytes("jpeg")
            img = Image.open(io.BytesIO(img_bytes))
            
            # Extract the hidden text from the pixels
            ocr_text = pytesseract.image_to_string(img)
            
            # Combine whatever tiny text layer existed with the fresh OCR data
            doc.page_content = doc.page_content + "\n\n" + ocr_text
            
            img.close()
            del pix, img_bytes, img, page
            gc.collect()

    pdf_document.close()
    del pdf_document

    # Increased chunk size and overlap to prevent slicing paragraphs in half!
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=300)
    chunks = text_splitter.split_documents(docs)

    # Release the loader/parser handle so the temp file can be deleted on Windows.
    del loader, docs
    gc.collect()

    return chunks

def add_single_document(url):
    """Triggered by Node.js when a new file is uploaded. Appends to existing collection."""
    print(f"🚀 Single file upload detected! Downloading from Cloudinary...")
    temp_pdf_path = "temp_single_upload.pdf"

    try:
        response = requests.get(url)
        with open(temp_pdf_path, 'wb') as f:
            f.write(response.content)

        new_chunks = process_and_split_pdf(temp_pdf_path)
        real_filename = url.split('/')[-1]
        new_chunks = [c for c in new_chunks if c.page_content.strip()]
        for chunk in new_chunks:
            tag_chunk_metadata(chunk, real_filename, url)
        if not new_chunks:
            print("⚠️ No usable text extracted from document. Aborting.")
            return

        client = get_qdrant_client()
        ensure_collection_exists(client)

        print(f"💉 Uploading {len(new_chunks)} new chunks to Qdrant...")
        vectorstore = QdrantVectorStore(
            client=client,
            collection_name=COLLECTION_NAME,
            embedding=embeddings
        )
        vectorstore.add_documents(new_chunks)
        print("✅ Success: Qdrant updated with new document chunks!")

    except Exception as e:
        print(f"❌ Failed to update Qdrant: {e}")
    finally:
        safe_remove(temp_pdf_path)


def run_master_sync(folder_name="Batas"):
    """
    Startup sync: fetches all PDFs from Cloudinary and uploads them to Qdrant.
    Safe to re-run — if the collection already has data, it skips re-ingestion.
    """
    print(f"🔍 Searching Cloudinary folder: '{folder_name}'...")

    client = get_qdrant_client()
    ensure_collection_exists(client)

    # Skip re-ingestion if the collection already has vectors
    count = client.count(collection_name=COLLECTION_NAME).count
    if count > 0:
        print(f"⚡ Qdrant already has {count} vectors. Skipping master sync — data is persistent!")
        return

    pdf_urls = []
    try:
        response = cloudinary.api.resources(
            type="upload",
            resource_type="raw",
            prefix=f"{folder_name}/",
            max_results=500
        )
        for item in response.get('resources', []):
            if item['secure_url'].lower().endswith('.pdf'):
                pdf_urls.append(item['secure_url'])
    except Exception as e:
        print(f"❌ Error connecting to Cloudinary: {e}")
        return

    if not pdf_urls:
        print("⚠️ No PDFs found in Cloudinary. Exiting.")
        return

    print(f"📚 Found {len(pdf_urls)} PDFs. Starting ingestion into Qdrant...")

    vectorstore = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings
    )

    for index, url in enumerate(pdf_urls):
        print(f"⬇️ [{index + 1}/{len(pdf_urls)}] Downloading: {url.split('/')[-1]}")
        # Unique temp name per document so a lingering file handle can never make
        # one document clobber the next.
        temp_pdf_path = f"temp_download_{index}.pdf"
        try:
            response = requests.get(url)
            with open(temp_pdf_path, 'wb') as f:
                f.write(response.content)

            splits = process_and_split_pdf(temp_pdf_path)
            real_filename = url.split('/')[-1]
            splits = [s for s in splits if s.page_content.strip()]
            for chunk in splits:
                tag_chunk_metadata(chunk, real_filename, url)
            if splits:
                print(f"   💉 Uploading {len(splits)} chunks to Qdrant...")
                vectorstore.add_documents(splits)
                print(f"   ✅ Done!")
            else:
                print(f"   ⚠️ No usable text extracted — skipped.")

            del splits
            gc.collect()

        except Exception as e:
            print(f"⚠️ Failed to process {url}. Error: {e}")
        finally:
            safe_remove(temp_pdf_path)

    final_count = client.count(collection_name=COLLECTION_NAME).count
    print(f"\n✅ SUCCESS: Master sync complete! Qdrant now has {final_count} vectors.")


def reset_collection():
    """Delete the Qdrant collection so the next sync re-embeds everything fresh."""
    client = get_qdrant_client()
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME in existing:
        print(f"Deleting collection '{COLLECTION_NAME}'...")
        client.delete_collection(COLLECTION_NAME)
        print("Collection deleted.")
    else:
        print(f"Collection '{COLLECTION_NAME}' does not exist yet - nothing to delete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', type=str, help='Cloudinary URL for single file injection')
    parser.add_argument('--reset', action='store_true',
                        help='Delete the Qdrant collection, then re-ingest every PDF from Cloudinary')
    args = parser.parse_args()

    if args.url:
        add_single_document(args.url)
    elif args.reset:
        reset_collection()
        run_master_sync()
    else:
        run_master_sync()

    print("Ingestion finished!")
    sys.stdout.flush()
    os._exit(0)