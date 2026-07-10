import sys
import os
import re
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
import json

# OpenAI-compatible providers (Groq, OpenRouter, GitHub Models) all go through
# ChatOpenAI. Imported defensively so the service still runs on Gemini alone if
# langchain-openai has not been installed yet.
try:
    from langchain_openai import ChatOpenAI
    _HAS_OPENAI = True
except ImportError:
    _HAS_OPENAI = False

load_dotenv()

COLLECTION_NAME = "Batas"

# ── Generation providers (multi-layer fallback) ──────────────────────────────
# Every model id is overridable via env so a deprecated id can be fixed without
# touching code. Chain order is by model quality (best first): the strongest
# free model is the core/primary and each fallback is the next strongest. Gemini
# is last both on quality and because its free-tier generation quota can drop to
# zero on some projects.
#   1. OpenRouter / DeepSeek V3   (core)
#   2. GitHub Models / GPT-5-mini
#   3. Groq / Llama 3.3 70B
#   4. Gemini 2.0 Flash
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3-0324:free")
GITHUB_MODEL = os.getenv("GITHUB_MODEL", "openai/gpt-5-mini")


def _openai_compatible(model, base_url, key_env):
    return ChatOpenAI(
        model=model,
        temperature=0,
        base_url=base_url,
        api_key=os.getenv(key_env),
        timeout=60,
        max_retries=0,
    )


def _build_gemini():
    return ChatGoogleGenerativeAI(
        model=GEMINI_MODEL,
        temperature=0,
        google_api_key=os.getenv("GOOGLE_API_KEY"),
    )


def get_provider_chain():
    """Ordered (best-quality first) list of (label, builder) for every provider
    whose key is set."""
    chain = []
    # 1. OpenRouter — DeepSeek V3 (core / strongest free model)
    if _HAS_OPENAI and os.getenv("OPENROUTER_API_KEY"):
        chain.append((f"{OPENROUTER_MODEL} (OpenRouter)",
                      lambda: _openai_compatible(OPENROUTER_MODEL, "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY")))
    # 2. GitHub Models — GPT-5-mini
    if _HAS_OPENAI and os.getenv("GITHUB_TOKEN"):
        chain.append((f"{GITHUB_MODEL} (GitHub Models)",
                      lambda: _openai_compatible(GITHUB_MODEL, "https://models.github.ai/inference", "GITHUB_TOKEN")))
    # 3. Groq — Llama 3.3 70B (fast)
    if _HAS_OPENAI and os.getenv("GROQ_API_KEY"):
        chain.append((f"{GROQ_MODEL} (Groq)",
                      lambda: _openai_compatible(GROQ_MODEL, "https://api.groq.com/openai/v1", "GROQ_API_KEY")))
    # 4. Gemini — final fallback
    if os.getenv("GOOGLE_API_KEY"):
        chain.append((f"{GEMINI_MODEL} (Gemini)", _build_gemini))
    return chain


def invoke_with_fallback(prompt):
    """Try each configured provider in order; return (text, model_label).

    A provider is skipped on any error (rate limit, auth, network) and the next
    one is tried. Raises only if every provider fails.
    """
    chain = get_provider_chain()
    if not chain:
        raise RuntimeError(
            "No model providers configured. Set at least one of GROQ_API_KEY, "
            "OPENROUTER_API_KEY, GITHUB_TOKEN, or GOOGLE_API_KEY."
        )
    errors = []
    for label, build in chain:
        try:
            llm = build()
            response = llm.invoke(prompt)
            content = (response.content or "").strip()
            if content:
                return content, label
            reason = "empty response"
        except Exception as e:
            reason = f"{type(e).__name__}: {e}"
        # Log to stderr (never stdout — the Node service parses stdout as JSON)
        # so a silently-skipped provider is visible in the CLI and Railway logs.
        print(f"[batas] provider skipped: {label} -> {reason}", file=sys.stderr)
        errors.append(f"{label}: {reason}")
    raise RuntimeError("All providers failed -> " + "; ".join(errors))


def _active_model_label():
    chain = get_provider_chain()
    if not chain:
        return "no model configured"
    primary = chain[0][0]
    extra = len(chain) - 1
    if extra:
        return f"{primary} +{extra} fallback{'s' if extra != 1 else ''}"
    return primary


# Display label for the status bar (primary provider + how many fallbacks exist).
ACTIVE_MODEL = _active_model_label()

# How many chunks to retrieve, and how many to hand to the model as citable sources.
RETRIEVE_K = 15
CONTEXT_K = 8

TEMP_NAMES = {"temp_download.pdf", "temp_single_upload.pdf"}


def derive_title(source: str) -> str:
    """Turn a raw PDF filename into a human-readable document title.

    e.g. 'Ordinance_No_123_Anti_Smoking.pdf' -> 'Ordinance No 123 Anti Smoking'
    """
    if not source:
        return "Unknown document"
    base = re.sub(r"\.pdf$", "", source, flags=re.IGNORECASE)
    base = base.replace("_", " ").replace("-", " ")
    base = re.sub(r"\s+", " ", base).strip()
    return base or source


def page_label(metadata: dict):
    """PyMuPDF stores a 0-indexed 'page'. Return a 1-indexed int for display, or None."""
    page = metadata.get("page")
    if page is None:
        return None
    try:
        return int(page) + 1
    except (TypeError, ValueError):
        return None


def ask_batas_api(question: str) -> dict:
    """Called by FastAPI — returns {'answer': str, 'sources': [ ... ]}.

    Sources are the numbered documents the model actually cited inline via [n]
    markers. Each source carries a display id, document title, page number and
    the original PDF url, so the UI can render per-claim citations.
    """
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

        # 1. Similarity search
        relevant_docs = vectorstore.similarity_search(question, k=RETRIEVE_K)

        # 2. Heuristic prioritisation when the user names a specific ordinance number
        mentioned = re.search(r'ordinance\s+(?:no\.?\s*|number\s*)?(\d+)', question, re.IGNORECASE)
        if mentioned:
            ord_num = mentioned.group(1)
            prioritized = [d for d in relevant_docs if ord_num in d.metadata.get('source', '')]
            others = [d for d in relevant_docs if ord_num not in d.metadata.get('source', '')]
            relevant_docs = prioritized + others

        relevant_docs = relevant_docs[:CONTEXT_K]

        # 3. Build numbered, citable source blocks
        candidates = []
        for i, doc in enumerate(relevant_docs, start=1):
            source = doc.metadata.get('source', 'Unknown')
            if source in TEMP_NAMES:
                source = doc.metadata.get('title') or 'Uploaded document'
            candidates.append({
                'n': i,
                'name': source,
                'title': doc.metadata.get('title') or derive_title(source),
                'page': page_label(doc.metadata),
                'url': doc.metadata.get('url', ''),
                'content': doc.page_content.strip(),
            })

        context_blocks = []
        for c in candidates:
            header = f"[{c['n']}] {c['title']}"
            if c['page']:
                header += f" (page {c['page']})"
            context_blocks.append(f"{header}\n{c['content']}")
        context = "\n\n".join(context_blocks)

        # 4. Prompt — inline numbered citations, no more secret tag
        prompt = f"""You are Batas, a professional AI assistant that analyzes Philippine local government ordinances and legal documents for citizens and officials.

Follow these rules exactly:

1. GREETINGS & SMALL TALK: If the user is only greeting you or making casual conversation, reply warmly and briefly. Do not cite anything in that case.
2. GROUNDING: Answer legal or ordinance questions STRICTLY from the numbered SOURCES below. Never rely on outside knowledge, and never invent fine amounts, dates, section numbers, penalties, or effectivity clauses.
3. CITATIONS: After every sentence or claim that draws on a source, add that source's number in square brackets, e.g. "Smoking in public parks is prohibited [2]." If a claim rests on more than one source, cite each, e.g. [1][3]. Only ever cite numbers that appear in SOURCES. Do not add a separate reference list at the end — the inline [n] markers are enough.
4. OCR NOISE: The source text may contain minor OCR scanning errors (e.g. "Adember" for "Member"). Interpret them sensibly rather than refusing.
5. MISSING INFORMATION: If the SOURCES do not contain the answer, reply exactly: "I cannot find this information in the available ordinances." Do not guess.
6. STYLE: Write in clear, well-structured Markdown. Use short paragraphs, and use bullet lists for enumerations such as penalties, requirements, or steps. Bold the key term of a definition. Stay precise, neutral, and concise.

--- SOURCES ---
{context}

--- USER QUESTION ---
{question}

Answer:"""

        # 5. Invoke the model (with multi-provider fallback)
        raw_answer, model_used = invoke_with_fallback(prompt)

        # 6. Resolve which sources were actually cited, in order of first appearance,
        #    and renumber them cleanly (1, 2, 3 ...) while de-duplicating by doc+page.
        by_n = {c['n']: c for c in candidates}
        order = []
        for token in re.findall(r'\[(\d+)\]', raw_answer):
            k = int(token)
            if k in by_n and k not in order:
                order.append(k)

        remap = {}          # original chunk number -> clean display id
        key_to_id = {}      # (name, page) -> clean display id  (de-dup)
        sources = []
        next_id = 1
        for orig in order:
            c = by_n[orig]
            key = (c['name'], c['page'])
            if key in key_to_id:
                remap[orig] = key_to_id[key]
                continue
            key_to_id[key] = next_id
            remap[orig] = next_id
            sources.append({
                'id': next_id,
                'name': c['name'],
                'title': c['title'],
                'page': c['page'],
                'url': c['url'],
                'snippet': c['content'][:280].strip(),
            })
            next_id += 1

        # Rewrite the inline markers to the clean, de-duplicated numbering.
        def _rewrite(match):
            k = int(match.group(1))
            return f"[{remap[k]}]" if k in remap else ""

        final_answer = re.sub(r'\[(\d+)\]', _rewrite, raw_answer).strip()

        return {"answer": final_answer, "sources": sources, "model": model_used}

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
