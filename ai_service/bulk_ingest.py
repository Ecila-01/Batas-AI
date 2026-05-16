import os
import requests
import argparse
import cloudinary
import cloudinary.api
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
import fitz 
import pytesseract
from PIL import Image
from langchain_core.documents import Document
import sys
import io
import gc


load_dotenv()
print(f"🔑 Debug Check - API Key Loaded: {os.getenv('GOOGLE_API_KEY')[:10]}...")

if sys.platform == 'win32':
    # If running on your local Windows PC
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
else:
    # If running on the Render Linux Container
    pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'
    
cloudinary.config( 
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME"), 
    api_key = os.getenv("CLOUDINARY_API_KEY"), 
    api_secret = os.getenv("CLOUDINARY_API_SECRET"),
    secure = True
)

embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-2",             
    google_api_key=os.getenv("GOOGLE_API_KEY")
)

def process_and_split_pdf(file_path):
    """Helper function to extract text with an ultra-low RAM OCR fallback"""
    
    # 1. Try standard text extraction first
    loader = PyMuPDFLoader(file_path)
    docs = loader.load()
    
    has_text = any(len(doc.page_content.strip()) > 10 for doc in docs)
    
    # 2. Trigger the Tesseract OCR Fallback if it's an image
    if not has_text:
        print("📸 Scanned image detected! Waking up Tesseract OCR...")
        ocr_text = ""
        
        pdf_document = fitz.open(file_path)
        for page_num in range(len(pdf_document)):
            print(f"   👁️ Scanning page {page_num + 1}...")
            page = pdf_document.load_page(page_num)
            
            # 🚀 OPTIMIZATION PACK: Drop DPI to 150 and use a lightweight grayscale format
            pix = page.get_pixmap(dpi=150, colorspace=fitz.csGRAY) 
            
            # Streams highly compressed JPEG bytes instead of heavy raw PNG matrices
            img_bytes = pix.tobytes("jpeg")
            img = Image.open(io.BytesIO(img_bytes))
            
            # Feed the lightweight image stream directly to Tesseract
            page_text = pytesseract.image_to_string(img)
            ocr_text += page_text + "\n\n"
            
            # Explicit, aggressive memory cleanup per page iteration
            img.close()
            del pix
            del img_bytes
            del img
            del page
            gc.collect()  # Flush reclaimed heap allocations immediately back to Linux
        
        pdf_document.close()
        del pdf_document
        gc.collect()
        
        docs = [Document(page_content=ocr_text, metadata={"source": file_path})]

    # 3. Chop it up
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    return text_splitter.split_documents(docs)


def add_single_document(url):
    """Triggered by Node.js when a new file is uploaded"""
    print(f"🚀 Single file upload detected! Downloading from Cloudinary...")
    temp_pdf_path = "temp_single_upload.pdf"
    
    try:
        # 1. Download the new file
        response = requests.get(url)
        with open(temp_pdf_path, 'wb') as f:
            f.write(response.content)

        # 2. Chop it up (with automatic Tesseract OCR fallback)
        new_chunks = process_and_split_pdf(temp_pdf_path)
        
        if not new_chunks:
            print("⚠️ No chunks generated from document. Aborting.")
            os.remove(temp_pdf_path)
            return

        # 3. Load the EXISTING database instance sitting in the container
        print("🧠 Opening existing FAISS database...")
        master_vectorstore = FAISS.load_local("Batas_index", embeddings, allow_dangerous_deserialization=True)
        
        # 4. Inject the new knowledge via safe isolated local micro-merges
        print(f"💉 Merging {len(new_chunks)} chunks of new knowledge sequentially...")
        for i, chunk in enumerate(new_chunks):
            text_content = chunk.page_content
            metadata_content = chunk.metadata
            
            # Safely fetch individual raw float list vector
            single_vector = embeddings.embed_documents([text_content])
            chunk_pair = list(zip([text_content], single_vector))
            
            # Construct standalone micro-instance matrix slice
            chunk_vectorstore = FAISS.from_embeddings(chunk_pair, embeddings, metadatas=[metadata_content])
            
            # Deep merge internal matrices natively
            master_vectorstore.merge_from(chunk_vectorstore)
            print(f"   📥 Vectorized and incremental-merged chunk [{i + 1}/{len(new_chunks)}] successfully!")
        
        # 5. Overwrite changes back to disk storage
        master_vectorstore.save_local("Batas_index")
        
        os.remove(temp_pdf_path)
        print("✅ Success: Local database instance updated with new document chunks!")
        
    except Exception as e:
        print(f"❌ Failed to update database: {e}")

def run_master_sync(folder_name="Batas"):
    """Triggered manually to build the whole database from scratch"""
    print(f"🔍 Searching Cloudinary folder: '{folder_name}'...")
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
        print("⚠️ No PDFs found. Exiting.")
        return

    print(f"📚 Found {len(pdf_urls)} PDFs. Starting master ingestion...")
    all_document_chunks = []
    
    for index, url in enumerate(pdf_urls):
        print(f"⬇️ [{index + 1}/{len(pdf_urls)}] Downloading: {url.split('/')[-1]}")
        temp_pdf_path = "temp_download.pdf"
        try:
            response = requests.get(url)
            with open(temp_pdf_path, 'wb') as f:
                f.write(response.content)

            splits = process_and_split_pdf(temp_pdf_path)
            all_document_chunks.extend(splits)
            os.remove(temp_pdf_path)
        except Exception as e:
            print(f"⚠️ Failed to process {url}. Error: {e}")

    if all_document_chunks:
        print(f"🧠 Generating massive FAISS index with {len(all_document_chunks)} chunks...")
        
        # 1. Initialize the master baseline structure using the first chunk primitive safely
        first_text = all_document_chunks[0].page_content
        first_meta = all_document_chunks[0].metadata
        first_vector = embeddings.embed_documents([first_text])
        
        print("🏗️ Initializing master database baseline instance...")
        seed_pair = list(zip([first_text], first_vector))
        master_vectorstore = FAISS.from_embeddings(seed_pair, embeddings, metadatas=[first_meta])
        
        # 2. Process each remaining item as its own micro-database slice and merge them smoothly
        print("💉 Merging chunks using isolated local instances to completely bypass wrapper bugs...")
        for i in range(1, len(all_document_chunks)):
            chunk = all_document_chunks[i]
            text_content = chunk.page_content
            metadata_content = chunk.metadata
            
            single_vector = embeddings.embed_documents([text_content])
            chunk_pair = list(zip([text_content], single_vector))
            
            chunk_vectorstore = FAISS.from_embeddings(chunk_pair, embeddings, metadatas=[metadata_content])
            master_vectorstore.merge_from(chunk_vectorstore)
            print(f"   📥 Vectorized and merged chunk [{i + 1}/{len(all_document_chunks)}] successfully!")

        # 3. Save the master binary baseline safely
        master_vectorstore.save_local("Batas_index")
        print("\n✅ SUCCESS: Master Index safely compiled and saved to 'Batas_index/'!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', type=str, help='Cloudinary URL for single file injection')
    args = parser.parse_args()

    if args.url:
        add_single_document(args.url)
    else:
        run_master_sync()
    print("👋 Master sync finished! Force killing ingestion thread to start Node.js server...")
    
    # This completely flushes stdout buffers and forcibly kills the current process id,
    sys.stdout.flush()
    os._exit(0)