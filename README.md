# DocMind – AI-Powered PDF Chatbot (RAG, fully offline)

A full-stack Retrieval-Augmented Generation (RAG) chatbot that lets you ask natural-language questions about any PDF document. Everything runs locally — no API keys, no cloud calls, no per-query cost.

---

## Architecture

```
User Query
    │
    ▼
React Frontend (Vite + React 18)
    │  HTTP/REST
    ▼
FastAPI Backend
    │
    ├─ [Step 1] PyPDF2                    → Extract raw text from PDF, page by page
    ├─ [Step 2] LangChain                 → RecursiveCharacterTextSplitter (chunk_size=800, overlap=150)
    ├─ [Step 3] sentence-transformers     → BAAI/bge-small-en-v1.5 embeddings (384-dim, local, CPU)
    ├─ [Step 4] ChromaDB                  → Per-document vector collection
    ├─ [Step 5] ChromaDB query            → Retrieve top-K relevant chunks
    └─ [Step 6] Ollama (llama3)           → Locally-hosted LLM generates the grounded answer
```

---

## Tech Stack & Justification

| Component      | Tool                                         | Reason                                                                 |
|----------------|-----------------------------------------------|-------------------------------------------------------------------------|
| PDF Loading    | PyPDF2                                        | Lightweight, no external deps, page-aware extraction                  |
| Text Chunking  | LangChain `RecursiveCharacterTextSplitter`    | Respects sentence/paragraph boundaries; overlap preserves context      |
| Embeddings     | `BAAI/bge-small-en-v1.5` (sentence-transformers) | Fast, local, high-quality 384-dim semantic embeddings; no API cost  |
| Vector Store   | ChromaDB                                      | Simple local persistence, one collection per document, easy querying  |
| LLM            | Llama 3 via Ollama (local)                    | Fully offline generation — no API key, no data leaves the machine     |
| Backend        | FastAPI + Uvicorn                             | Async, auto-generates OpenAPI docs, production-ready                   |
| Frontend       | React 18 + Vite                               | Fast HMR, modern JSX, no heavy framework overhead                      |

---

## Quick Start

### Prerequisites
- Python 3.9+
- Node.js 18+
- [Ollama](https://ollama.com) installed and running locally, with the `llama3` model pulled:
  ```bash
  ollama pull llama3
  ```

### One-command setup (macOS)

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd pdf-chatbot

# 2. Make the setup script executable and run it
chmod +x setup.sh
./setup.sh
```

The script checks Python & Node.js, creates a Python virtualenv, installs backend + frontend dependencies, and starts both servers concurrently.

Then open **http://localhost:3000** in your browser.

---

### Manual Setup (any OS)

#### 0. Start Ollama (separate terminal, keep it running)
```bash
ollama serve
```

#### Backend
```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
```

---

## API Endpoints

| Method | Endpoint                | Description                                  |
|--------|--------------------------|-----------------------------------------------|
| GET    | `/`                      | Health check                                  |
| GET    | `/health`                | Model/status info                             |
| POST   | `/upload`                | Upload PDF → runs pipeline steps 1–4          |
| GET    | `/documents`             | List all indexed documents                    |
| DELETE | `/documents/{doc_id}`    | Remove a document and its vector collection   |
| POST   | `/chat`                  | Query → runs steps 5–6, returns answer + chunks |

Interactive API docs: **http://localhost:8000/docs**

---

## RAG Pipeline Details

### Step 1 – PDF Loading (PyPDF2)
Extracts text page-by-page, prefixing each page with `[Page N]` markers for traceability.

### Step 2 – Text Chunking (LangChain)
`RecursiveCharacterTextSplitter` splits on `\n\n`, `\n`, `. `, ` ` in order of preference, producing 800-character chunks with 150-character overlap.

### Step 3 – Embedding (sentence-transformers)
`BAAI/bge-small-en-v1.5` encodes each chunk into a 384-dimensional dense vector, normalized for cosine similarity. Runs locally on CPU — no API calls.

### Step 4 – Vector Indexing (ChromaDB)
Each uploaded document gets its own Chroma collection (named by `doc_id`), so documents never share an index.

### Step 5 – Retrieval
The user's query is embedded with the same model and queried against the document's Chroma collection. The top-K chunks (default 8, configurable via the UI slider) come back with similarity scores.

### Step 6 – Generation (Ollama / Llama 3)
The top 4 retrieved chunks are formatted as numbered context blocks and sent to a locally running `llama3` model via the Ollama REST API (`http://localhost:11434`), with a prompt that instructs the model to answer only from the given context and say "Not available in document" otherwise.

---

## Project Structure

```
pdf-chatbot/
├── backend/
│   ├── main.py           # FastAPI app + full RAG pipeline
│   ├── requirements.txt  # Python dependencies
│   ├── .env.example      # Environment template (currently unused, see file)
│   └── uploads/          # Uploaded PDFs (git-ignored, auto-created)
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main React component
│   │   ├── App.css       # Styling
│   │   └── main.jsx      # Entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── setup.sh              # One-shot macOS setup script
└── README.md
```

---

## Troubleshooting

**`ModuleNotFoundError`** — Make sure the venv is activated: `source backend/venv/bin/activate`

**`LLM Error: ...` in the chat response** — Ollama isn't running, or the `llama3` model isn't pulled. Run `ollama serve` in a separate terminal and `ollama pull llama3`.

**`Could not extract text from PDF`** — The PDF may be scanned/image-based. Use a PDF with selectable text, or add an OCR step (e.g. `pytesseract`).

**CORS error in browser** — Ensure the backend is running on port 8000 and CORS origins in `main.py` include `http://localhost:3000`.

**Port already in use** — Kill existing processes: `lsof -ti:8000 | xargs kill` or `lsof -ti:3000 | xargs kill`.

**First upload is slow** — The embedding model (`BAAI/bge-small-en-v1.5`) downloads on first run and is cached afterward.
>>>>>>> 35aff6a (Initial commit: DocMind offline RAG PDF chatbot)
