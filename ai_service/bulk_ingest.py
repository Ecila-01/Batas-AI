import os
import argparse
import requests
import io
import sys
import pymupdf
import cloudinary
import cloudinary.api
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

# Force standard output to handle UTF-8 cleanly if Windows terminal supports it
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

# 1. LOCK THE DIRECTORY PATHS AND LOAD LOCAL CORES
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

# Configure the official Cloudinary SDK dynamically from environment variables
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

# =========================================================================
# 2. DYNAMIC CROSS-PLATFORM TESSERACT CONFIGURATION (WINDOWS & LINUX)
# =========================================================================
if sys.platform == "win32":
    # Local Windows Environment Development Configuration
    tesseract_folder = r"C:\Program Files\Tesseract-OCR"
    os.environ["TESSDATA_PREFIX"] = os.path.join(tesseract_folder, "tessdata")
    os.environ["PATH"] += os.pathsep + tesseract_folder
else:
    # Live Linux Cloud Production Environment Configuration (Render Docker)
    # On Linux containers, installing tesseract via apt handles binary locations.
    # We explicitly define the fallback data paths for languages if needed.
    if os.path.exists("/usr/share/tesseract-ocr/5.00/tessdata"):
        os.environ["TESSDATA_PREFIX"] = "/usr/share/tesseract-ocr/5.00/tessdata"
    elif os.path.exists("/usr/share/tesseract-ocr/tessdata"):
        os.environ["TESSDATA_PREFIX"] = "/usr/share/tesseract-ocr/tessdata"

INDEX_PATH = os.path.join(BASE_DIR, "batas_index")

def extract_text_from_url_with_ocr(cloudinary_url):
    """Downloads a protected PDF from Cloudinary using SDK headers and extracts text using OCR."""
    print("Downloading protected file stream from Cloudinary via SDK...")
    try:
        api_key = os.getenv("CLOUDINARY_API_KEY")
        api_secret = os.getenv("CLOUDINARY_API_SECRET")
        
        if not api_key or not api_secret:
            raise ValueError("Cloudinary configuration strings could not be resolved inside env.")

        # Realize download utilizing standard session configurations with authorization headers
        response = requests.get(cloudinary_url, auth=(api_key, api_secret))
        response.raise_for_status() 
        
        # Open the PDF byte stream natively in memory
        pdf_stream = io.BytesIO(response.content)
        doc = pymupdf.open(stream=pdf_stream, filetype="pdf")
        
        print(f"Extracting text via OCR ({len(doc)} pages)...")
        full_text = ""
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            try:
                tp = page.get_textpage_ocr(flags=3, language="eng")
                text = page.get_text(textpage=tp)
                full_text += f"\n{text}"
            except Exception as e:
                print(f"Warning: Could not OCR page {page_num + 1}")
        return full_text
    except Exception as e:
        print(f"Error: Failed to download or process cloud file: {str(e)}")
        return ""

def main():
    # 3. SET UP PARSER TO ACCEPT URL FROM NODE
    parser = argparse.ArgumentParser(description="Batas AI RAG Ingestion Pipeline")
    parser.add_argument('--url', type=str, required=True, help='The secure Cloudinary URL of the PDF file')
    args = parser.parse_args()

    cloudinary_url = args.url
    filename = cloudinary_url.split('/')[-1] 

    # 4. PROCESS THE INCOMING DOCUMENT
    extracted_text = extract_text_from_url_with_ocr(cloudinary_url)
    
    if not extracted_text.strip():
        print("Error: No text could be extracted from this document.")
        return

    print("Chunking legal data blocks...")
    document = Document(page_content=extracted_text, metadata={"source": filename, "url": cloudinary_url})
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents([document])
    
    print(f"Created {len(chunks)} text chunks. Loading embeddings framework...")
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

    # 5. SMART APPEND LOGIC
    if os.path.exists(INDEX_PATH):
        print("Existing FAISS index found. Appending new vector blocks to brain...")
        try:
            vector_store = FAISS.load_local(INDEX_PATH, embeddings, allow_dangerous_deserialization=True)
            vector_store.add_documents(chunks)
        except Exception as e:
            print(f"Warning: Could not load existing index cleanly ({str(e)}). Generating fresh framework...")
            vector_store = FAISS.from_documents(chunks, embeddings)
    else:
        print("No existing index found. Initializing fresh baseline FAISS matrix...")
        vector_store = FAISS.from_documents(chunks, embeddings)

    # 6. SAVE BACK TO THE SERVER DISK
    print("Syncing localized FAISS binary stores to disk...")
    vector_store.save_local(INDEX_PATH)
    print("Success: Ingestion complete for this document!")

if __name__ == "__main__":
    main()