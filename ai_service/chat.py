import sys
import os
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient

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

        relevant_docs = vectorstore.similarity_search(question, k=4)
        context = "\n\n".join([doc.page_content for doc in relevant_docs])

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

        response = llm.invoke(prompt)
        print(response.content.strip())

    except Exception as e:
        print(f"Error processing request: {str(e)}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_query = sys.argv[1]

        if user_query == "--get-model":
            print(ACTIVE_MODEL)
        else:
            ask_batas(user_query)
    else:
        print("Error: No question provided.")