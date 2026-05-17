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

def ask_batas_api(question: str) -> dict:
    """Called by FastAPI — returns a dict directly."""
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

        # 1. Similarity Search
        relevant_docs = vectorstore.similarity_search(question, k=6)

        # 2. Heuristic filtering for Ordinance numbers
        mentioned = re.search(r'ordinance\s+(?:no\.?\s*|number\s*)?(\d+)', question, re.IGNORECASE)
        if mentioned:
            ord_num = mentioned.group(1)
            prioritized = [d for d in relevant_docs if ord_num in d.metadata.get('source', '')]
            others = [d for d in relevant_docs if ord_num not in d.metadata.get('source', '')]
            relevant_docs = (prioritized + others)[:4]

        context = "\n\n".join([doc.page_content for doc in relevant_docs])

        # 3. Pre-extract the source file
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

        # 4. Prompt
        prompt = f"""
        You are Batas, a professional AI assistant specializing in analyzing local laws and ordinances.

        INSTRUCTIONS:
        1. GREETINGS & CHAT: If the user says hello, greets you, or asks a general non-legal question, respond warmly. If you are ONLY greeting the user, DO NOT add the secret tag at the end.
        2. DOCUMENT ANALYSIS: Answer questions STRICTLY using the DOCUMENT TEXT below. Do not use outside knowledge or hallucinate fine amounts.
        3. OCR ERRORS: The text contains minor OCR scanning errors (e.g., "Adember" means "Member"). Interpret these intelligently.
        4. MISSING INFO: If the DOCUMENT TEXT does not contain the exact answer, you MUST state: "I cannot find this specific information in the provided document." Do not guess.
        5. THE SECRET TAG: If, and ONLY if, you use the DOCUMENT TEXT to answer a legal/ordinance question, you MUST append this exact tag at the very end of your response: <USED_CONTEXT>

        --- DOCUMENT TEXT ---
        {context}

        --- USER QUESTION ---
        {question}
        """

        # 5. Invoke LLM
        response = llm.invoke(prompt)
        raw_answer = response.content.strip()

        # 6. Gatekeeper
        if "<USED_CONTEXT>" in raw_answer:
            final_answer = raw_answer.replace("<USED_CONTEXT>", "").strip()
            final_sources = sources
        else:
            final_answer = raw_answer
            final_sources = []

        return {"answer": final_answer, "sources": final_sources}

    except Exception as e:
        return {"answer": f"Error processing request: {str(e)}", "sources": []}


# ── CLI entry point (for local testing) ──────────────────────────────────────
def ask_batas(question: str):
    result = ask_batas_api(question)
    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_query = sys.argv[1]
        if user_query == "--get-model":
            print(ACTIVE_MODEL)
        else:
            ask_batas(user_query)
    else:
        print(json.dumps({"answer": "Error: No question provided.", "sources": []}))
