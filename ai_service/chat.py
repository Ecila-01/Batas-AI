import sys
import os
import re
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
import json
load_dotenv()

ACTIVE_MODEL = "gemini-2.5-flash"
COLLECTION_NAME = "Batas"

def ask_batas(question):
    try:
        embeddings = GoogleGenerativeAIEmbeddings(
            model="gemini-embedding-2",
            google_api_key=os.getenv("GOOGLE_API_KEY")
        )

        client = QdrantClient(
            url=os.getenv("QDRANT_URL"),
            api_key=os.getenv("QDRANT_API_KEY")
        )

        vectorstore = QdrantVectorStore(
            client=client,
            collection_name=COLLECTION_NAME,
            embedding=embeddings
        )

        llm = ChatGoogleGenerativeAI(model=ACTIVE_MODEL, temperature=0)

        relevant_docs = vectorstore.similarity_search(question, k=6)

        mentioned = re.search(r'ordinance\s+(?:no\.?\s*|number\s*)?(\d+)', question, re.IGNORECASE)

        if mentioned:
            ord_num = mentioned.group(1)
            # Prioritize chunks whose source filename contains the ordinance number
            prioritized = [d for d in relevant_docs if ord_num in d.metadata.get('source', '')]
            others = [d for d in relevant_docs if ord_num not in d.metadata.get('source', '')]
            relevant_docs = (prioritized + others)[:4]  # Put matching source first

        context = "\n\n".join([doc.page_content for doc in relevant_docs])

        # 1. Extract sources first
        seen = set()
        sources = []
        for doc in relevant_docs:
            source = doc.metadata.get('source', 'Unknown')
            url = doc.metadata.get('url', '')
            if source not in seen and source != 'temp_download.pdf':
                seen.add(source)
                sources.append({'name': source, 'url': url})
            if len(sources) == 1:
                break

        # 2. Build prompt
        prompt = f"""
        You are Batas, a polite and professional AI assistant specializing in analyzing local laws, ordinances, and legal documents from any municipality.
        
        INSTRUCTIONS:
        1. GREETINGS & CHAT: If the user simply says hello, greets you, or says thank you, respond warmly and naturally.
        2. DOCUMENT ANALYSIS: If the user asks a specific question about a law or ordinance, you must use ONLY the 'DOCUMENT TEXT' provided below to answer. 
        3. MISSING INFORMATION: If the answer is not contained within the 'DOCUMENT TEXT', do not hallucinate or make up laws. Instead, gracefully say something like: "I do not see that information in the currently loaded documents. However, you can use the 'Upload Ordinance' button to add your specific PDF, and I will gladly analyze it for you."

        --- DOCUMENT TEXT ---
        {context}
        
        --- USER QUESTION ---
        {question}
        """

        # 3. Invoke LLM
        response = llm.invoke(prompt)

        # 4. Build and print output
        output = {
            "answer": response.content.strip(),
            "sources": sources
        }
        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"answer": f"Error processing request: {str(e)}", "sources": []}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_query = sys.argv[1]

        if user_query == "--get-model":
            print(ACTIVE_MODEL)
        else:
            ask_batas(user_query)
    else:
        print("Error: No question provided.")