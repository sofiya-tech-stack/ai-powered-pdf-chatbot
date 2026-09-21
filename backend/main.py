
"""
DocMind – Fully Offline RAG PDF Chatbot Backend
Uses:
- PyPDF2 (PDF parsing)
- SentenceTransformers (local embeddings)
- ChromaDB (vector search)
- Ollama (local LLM - llama3)

NO API KEYS REQUIRED
"""

import os
import uuid
import numpy as np
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import PyPDF2
import requests

from sentence_transformers import SentenceTransformer
from langchain.text_splitter import RecursiveCharacterTextSplitter

import chromadb
from chromadb.config import Settings

chroma_client = chromadb.Client(
    Settings(persist_directory="./chroma_db")
)
# ── App setup ─────────────────────────────────────────
app = FastAPI(title="DocMind Offline API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

documents = {}

# ── Load embedding model ──────────────────────────────
print("⏳ Loading embedding model...")
embedder = SentenceTransformer("BAAI/bge-small-en-v1.5", device="cpu")
EMBED_DIM = 384
print("✅ Embedding model ready.")

# ── Models ────────────────────────────────────────────
class ChatRequest(BaseModel):
    doc_id: str
    question: str
    top_k: Optional[int] = 8

class ChatResponse(BaseModel):
    answer: str
    retrieved_chunks: list
    doc_name: str

# ── RAG Steps ─────────────────────────────────────────
def step1_load_pdf(file_path: Path):
    text = ""
    with open(file_path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        page_count = len(reader.pages)
        for i, page in enumerate(reader.pages):
            content = page.extract_text()
            if content:
                text += f"\n[Page {i+1}]\n{content}"
    return text.strip(), page_count

def step2_chunk_text(text: str):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=150
    )
    return splitter.split_text(text)


def step3_embeddings(chunks: list[str]):
    embeddings = embedder.encode(
        chunks,
        normalize_embeddings=True
    )
    return embeddings.tolist()

def step4_store_in_db(doc_id, chunks, embeddings):
    collection = chroma_client.get_or_create_collection(name=doc_id)

    collection.add(
        documents=chunks,
        embeddings=embeddings,
        ids=[f"{doc_id}_{i}" for i in range(len(chunks))]
    )
def step5_retrieve(query: str, doc_id: str, k: int = 5):
    collection = chroma_client.get_collection(name=doc_id)

    q_vec = embedder.encode(
        [query],
        normalize_embeddings=True
    ).tolist()

    results = collection.query(
        query_embeddings=q_vec,
        n_results=k
    )

    hits = []
    for i in range(len(results["documents"][0])):
        hits.append({
            "text": results["documents"][0][i],
            "score": results["distances"][0][i]
        })

    return hits

def step6_generate(question, chunks, doc_name):
    chunks = chunks[:4]

    context = "\n\n---\n\n".join(
        [f"[Chunk {i+1}]: {c['text']}" for i, c in enumerate(chunks)]
    )

    prompt = f"""
Answer ONLY using context.

{context}

Question: {question}

If not found, say: Not available in document.
"""

    try:
        res = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3",
                "prompt": prompt,
                "stream": False
            },
            timeout=60
        )
        return res.json()["response"].strip()
    except Exception as e:
        return f"LLM Error: {str(e)}"

# ── API ───────────────────────────────────────────────
@app.get("/")
def root():
    return {"msg": "Offline RAG running"}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "embedding": "MiniLM",
        "llm": "llama3 (Ollama local)"
    }

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF")

    doc_id = str(uuid.uuid4())
    path = UPLOAD_DIR / f"{doc_id}.pdf"

    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)

    text, page_count = step1_load_pdf(path)
    if not text:
        raise HTTPException(422, "No text extracted")

    chunks = step2_chunk_text(text)
    emb = step3_embeddings(chunks)
    step4_store_in_db(doc_id, chunks, emb)

    documents[doc_id] = {
        "name": file.filename,
        "page_count": page_count,
        "chunk_count": len(chunks),
    }

    return {
        "doc_id": doc_id,
        "name": file.filename,
        "page_count": page_count,
        "chunk_count": len(chunks),
    }

@app.get("/documents")
def list_documents():
    return [
        {"doc_id": doc_id, "name": doc["name"], "page_count": doc["page_count"], "chunk_count": doc["chunk_count"]}
        for doc_id, doc in documents.items()
    ]

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if doc_id not in documents:
        raise HTTPException(404, "Doc not found")

    try:
        chroma_client.delete_collection(name=doc_id)
    except Exception:
        pass

    del documents[doc_id]
    return {"deleted": doc_id}

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if req.doc_id not in documents:
        raise HTTPException(404, "Doc not found")

    doc = documents[req.doc_id]

    hits = step5_retrieve(req.question, req.doc_id, k=req.top_k)

    answer = step6_generate(req.question, hits, doc["name"])

    return ChatResponse(
        answer=answer,
        retrieved_chunks=hits,
        doc_name=doc["name"]
    )
