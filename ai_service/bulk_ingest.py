import os
import pymupdf
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document

# 1. SETUP TESSERACT PATHS
tesseract_folder = r"C:\Program Files\Tesseract-OCR"
os.environ["TESSDATA_PREFIX"] = os.path.join(tesseract_folder, "tessdata")
os.environ["PATH"] += os.pathsep + tesseract_folder

# 2. LOCK THE DIRECTORY PATH
# This guarantees Python always looks inside 'ai_service' regardless of where your terminal is
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def extract_text_with_ocr(pdf_path):
    """Extracts text from a single PDF using OCR."""
    print(f"📄 Extracting: {os.path.basename(pdf_path)}")
    doc = pymupdf.open(pdf_path)
    full_text = ""
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        try:
            tp = page.get_textpage_ocr(flags=3, language="eng")
            text = page.get_text(textpage=tp)
            full_text += f"\n{text}"
        except Exception as e:
            print(f"  [!] Warning: Could not OCR page {page_num + 1}")
    return full_text

def ingest_directory():
    """Loops through the ordinances folder and creates the FAISS database."""
    # Tell Python exactly where the ordinances folder is located
    data_dir = os.path.join(BASE_DIR, "ordinances")
    
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
        print(f"Created '{data_dir}' folder. Please place your PDFs inside and run again.")
        return

    print(f"Scanning the '{data_dir}' directory for scanned PDFs...\n")
    documents = []
    
    # Loop through every PDF in the folder
    for filename in os.listdir(data_dir):
        if filename.lower().endswith(".pdf"):
            pdf_path = os.path.join(data_dir, filename)
            extracted_text = extract_text_with_ocr(pdf_path)
            
            # LangChain expects "Document" objects, so we wrap the text
            if extracted_text.strip():
                documents.append(Document(page_content=extracted_text, metadata={"source": filename}))

    if not documents:
        print("\nNo text was extracted. Are there PDFs in the folder?")
        return

    print(f"\nSuccessfully extracted text from {len(documents)} files. Chunking data...")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(documents)
    
    print(f"Created {len(chunks)} chunks. Generating embeddings...")
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

    print("Saving to FAISS database...")
    # Tell Python exactly where to save the FAISS database
    index_path = os.path.join(BASE_DIR, "batas_index")
    vector_store = FAISS.from_documents(chunks, embeddings)
    vector_store.save_local(index_path)
    
    print("\n✅ Ingestion complete! The AI has absorbed the ordinances.")

if __name__ == "__main__":
    ingest_directory()