import { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:8000";

// ── Pipeline step config ───────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { id: "load",     label: "Load PDF",        icon: "📥", phase: "upload" },
  { id: "chunk",    label: "Chunk text",       icon: "✂️",  phase: "upload" },
  { id: "embed",    label: "Embed chunks",     icon: "🔢", phase: "upload" },
  { id: "store",    label: "Index vectors",    icon: "🗄️",  phase: "upload" },
  { id: "retrieve", label: "Retrieve context", icon: "🔍", phase: "chat"   },
  { id: "generate", label: "Generate answer",  icon: "🤖", phase: "chat"   },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function mdToJsx(text) {
  // Very light markdown → JSX (bold, inline code, newlines)
  return text.split("\n").map((line, li) => (
    <span key={li}>
      {line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, si) => {
        if (seg.startsWith("**") && seg.endsWith("**"))
          return <strong key={si}>{seg.slice(2, -2)}</strong>;
        if (seg.startsWith("`") && seg.endsWith("`"))
          return <code key={si} className="inline-code">{seg.slice(1, -1)}</code>;
        return seg;
      })}
      {li < text.split("\n").length - 1 && <br />}
    </span>
  ));
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [docs, setDocs]             = useState([]);
  const [activeDoc, setActiveDoc]   = useState(null);
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [busy, setBusy]             = useState(false);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [steps, setSteps]           = useState({});   // stepId -> 'idle'|'active'|'done'
  const [error, setError]           = useState(null);
  const [topK, setTopK]             = useState(5);

  const fileRef    = useRef(null);
  const msgEnd     = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Step helpers ────────────────────────────────────────────────────────
  const setStep = (id, state) =>
    setSteps(prev => ({ ...prev, [id]: state }));

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function runUploadSteps() {
    for (const id of ["load", "chunk", "embed", "store"]) {
      setStep(id, "active");
      await sleep(450);
      setStep(id, "done");
    }
  }

  function resetChatSteps() {
    setSteps(prev => ({ ...prev, retrieve: "idle", generate: "idle" }));
  }

  function markAllDone() {
    const s = {};
    PIPELINE_STEPS.forEach(st => (s[st.id] = "done"));
    setSteps(s);
  }

  // ── Upload ──────────────────────────────────────────────────────────────
  async function handleFiles(fileList) {
    const pdfs = [...fileList].filter(f => f.type === "application/pdf");
    if (!pdfs.length) { setError("Please upload PDF files only."); return; }
    setError(null);

    for (const file of pdfs) {
      if (docs.find(d => d.name === file.name)) continue;
      setUploading(true);
      setSteps({ load:"idle",chunk:"idle",embed:"idle",store:"idle",retrieve:"idle",generate:"idle" });

      const form = new FormData();
      form.append("file", file);

      const stepAnim = runUploadSteps();

      try {
        const res  = await fetch(`${API}/upload`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");

        await stepAnim;
        const doc = { ...data };
        setDocs(prev => [...prev, doc]);
        handleSelectDoc(doc, true);
      } catch (e) {
        setError(e.message);
        setSteps({});
      } finally {
        setUploading(false);
      }
    }
  }

  function handleSelectDoc(doc, fresh = false) {
    setActiveDoc(doc);
    setError(null);
    if (fresh) {
      setMessages([{
        role: "assistant",
        text: `**${doc.name}** is ready — ${doc.page_count} pages, ${doc.chunk_count} chunks indexed.\n\nAsk me anything about this document!`,
        sources: [],
      }]);
      markAllDone();
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function removeDoc(doc_id) {
    await fetch(`${API}/documents/${doc_id}`, { method: "DELETE" }).catch(() => {});
    setDocs(prev => prev.filter(d => d.doc_id !== doc_id));
    if (activeDoc?.doc_id === doc_id) {
      const remaining = docs.filter(d => d.doc_id !== doc_id);
      if (remaining.length) handleSelectDoc(remaining[0]);
      else { setActiveDoc(null); setMessages([]); setSteps({}); }
    }
  }

  // ── Chat ────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const q = input.trim();
    if (!q || busy || !activeDoc) return;

    setBusy(true);
    setInput("");
    setError(null);
    setMessages(prev => [...prev, { role: "user", text: q, sources: [] }]);

    resetChatSteps();
    setStep("retrieve", "active");
    await sleep(350);
    setStep("retrieve", "done");
    setStep("generate", "active");

    // Thinking bubble
    setMessages(prev => [...prev, { role: "thinking", text: "", sources: [] }]);

    try {
      const res  = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: activeDoc.doc_id, question: q, top_k: topK }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Chat error");

      setStep("generate", "done");
      setMessages(prev =>
        prev.filter(m => m.role !== "thinking").concat({
          role: "assistant",
          text: data.answer,
          sources: data.retrieved_chunks,
        })
      );
    } catch (e) {
      setStep("generate", "");
      setMessages(prev =>
        prev.filter(m => m.role !== "thinking").concat({
          role: "error",
          text: e.message,
          sources: [],
        })
      );
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [docs]);

  const stepState = id => steps[id] || "idle";

  // ── Suggestions ─────────────────────────────────────────────────────────
  const SUGGESTIONS = [
    "Summarize this document",
    "What are the key topics?",
    "What are the main conclusions?",
    "List the most important facts",
  ];

  return (
    <div className="app">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="logo">
            <span className="logo-icon">📑</span>
            <span className="logo-text">Doc<em>Mind</em></span>
          </div>
          <p className="logo-sub">AI PDF Chatbot · RAG Pipeline</p>
        </div>

        {/* Upload Zone */}
        <div
          className={`upload-zone ${dragging ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileRef} type="file" accept=".pdf" multiple hidden
            onChange={e => handleFiles(e.target.files)}
          />
          {uploading
            ? <><div className="spinner" /><span>Processing…</span></>
            : <><span className="upload-icon">+</span><span>Drop PDF or click</span></>
          }
        </div>

        {/* Pipeline */}
        <div className="section-title">RAG Pipeline</div>
        <div className="pipeline">
          {PIPELINE_STEPS.map((st, i) => (
            <div key={st.id} className={`p-step p-step--${stepState(st.id)}`}>
              <div className="p-step__dot">
                {stepState(st.id) === "done" ? "✓" : i + 1}
              </div>
              <span className="p-step__icon">{st.icon}</span>
              <span className="p-step__label">{st.label}</span>
            </div>
          ))}
        </div>

        {/* Doc list */}
        <div className="section-title">Documents</div>
        <div className="doc-list">
          {docs.length === 0
            ? <p className="doc-empty">No documents yet</p>
            : docs.map(d => (
              <div
                key={d.doc_id}
                className={`doc-item ${activeDoc?.doc_id === d.doc_id ? "active" : ""}`}
                onClick={() => handleSelectDoc(d)}
              >
                <span className="doc-item__icon">📄</span>
                <div className="doc-item__info">
                  <div className="doc-item__name">{d.name}</div>
                  <div className="doc-item__meta">{d.page_count}pp · {d.chunk_count} chunks</div>
                </div>
                <button
                  className="doc-item__del"
                  onClick={e => { e.stopPropagation(); removeDoc(d.doc_id); }}
                >✕</button>
              </div>
            ))
          }
        </div>

        {/* Settings */}
        <div className="settings">
          <label className="settings-label">
            Chunks retrieved (top-k)
            <div className="settings-row">
              <input
                type="range" min={1} max={10} step={1} value={topK}
                onChange={e => setTopK(Number(e.target.value))}
              />
              <span className="settings-val">{topK}</span>
            </div>
          </label>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main className="main">
        {!activeDoc ? (
          <div className="empty-state">
            <div className="empty-art">📚</div>
            <h2>Upload a PDF to begin</h2>
            <p>Drop a PDF in the sidebar — the RAG pipeline will index it<br />and you can ask questions in natural language.</p>
          </div>
        ) : (
          <>
            {/* Doc bar */}
            <div className="doc-bar">
              <span className="doc-bar__icon">📄</span>
              <div className="doc-bar__info">
                <div className="doc-bar__name">{activeDoc.name}</div>
                <div className="doc-bar__meta">
                  {activeDoc.page_count} pages · {activeDoc.word_count?.toLocaleString()} words · {activeDoc.chunk_count} chunks indexed
                </div>
              </div>
              <span className="doc-bar__badge">FAISS · MiniLM-L6</span>
            </div>

            {/* Messages */}
            <div className="messages">
              {messages.map((msg, i) => (
                <div key={i} className={`msg msg--${msg.role}`}>
                  <div className="msg__avatar">
                    {msg.role === "user" ? "U" : msg.role === "thinking" ? "…" : "🤖"}
                  </div>
                  <div className="msg__body">
                    {msg.role === "thinking" && (
                      <div className="thinking">
                        <span /><span /><span />
                        <em>Generating answer…</em>
                      </div>
                    )}
                    {msg.role === "error" && (
                      <div className="error-bubble">⚠ {msg.text}</div>
                    )}
                    {(msg.role === "user" || msg.role === "assistant") && (
                      <div className="msg__bubble">{mdToJsx(msg.text)}</div>
                    )}
                    {msg.sources?.length > 0 && (
                      <div className="sources">
                        <div className="sources__label">Retrieved chunks</div>
                        <div className="sources__chips">
                          {msg.sources.map((s, si) => (
                            <span key={si} className="source-chip" title={s.text.slice(0, 200)}>
                              Chunk {s.chunk_index + 1} · {s.score.toFixed(3)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={msgEnd} />
            </div>

            {/* Suggestions */}
            {messages.length === 1 && (
              <div className="suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="suggestion" onClick={() => { setInput(s); sendMessage(); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {error && <div className="error-bar">⚠ {error}</div>}

            {/* Input */}
            <div className="input-area">
              <div className={`input-wrap ${busy ? "input-wrap--busy" : ""}`}>
                <textarea
                  ref={inputRef}
                  className="input-field"
                  placeholder="Ask anything about your document…"
                  value={input}
                  rows={1}
                  disabled={busy}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                />
                <button
                  className="send-btn"
                  disabled={busy || !input.trim()}
                  onClick={sendMessage}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
              <p className="input-hint">Enter to send · Shift+Enter for newline</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
