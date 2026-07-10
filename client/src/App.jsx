import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

/* ------------------------------------------------------------------ *
 * Icons (inline, stroke-based — no icon dependency)
 * ------------------------------------------------------------------ */
const Icon = {
  scale: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M16 16c0 1.105-1.79 2-4 2s-4-.895-4-2" /><path d="M12 2v16" />
      <path d="M4 7h16" /><path d="M4 7l4 9" /><path d="M20 7l-4 9" /><path d="M9 22h6" />
    </svg>
  ),
  user: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  send: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  upload: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  trash: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  plus: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  menu: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  close: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  doc: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  external: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  sun: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </svg>
  ),
  moon: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  github: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ *
 * rehype plugin: turn inline [n] markers into <citeref> elements so
 * they render as clickable citation superscripts inside markdown.
 * ------------------------------------------------------------------ */
function splitCitations(value) {
  const out = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    out.push({
      type: 'element',
      tagName: 'citeref',
      properties: { dataCite: m[1] },
      children: [{ type: 'text', value: m[1] }],
    });
    last = m.index + m[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function walkForCitations(node) {
  if (!node || !node.children) return;
  if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'text' && /\[\d+\]/.test(child.value)) {
      const parts = splitCitations(child.value);
      node.children.splice(i, 1, ...parts);
      i += parts.length - 1;
    } else {
      walkForCitations(child);
    }
  }
}

function rehypeCitations() {
  return (tree) => walkForCitations(tree);
}

/* ------------------------------------------------------------------ *
 * Markdown message with clickable citation markers
 * ------------------------------------------------------------------ */
function MarkdownMessage({ text, sources, onOpenSource }) {
  const sourceById = useMemo(() => {
    const map = {};
    (sources || []).forEach((s) => { map[String(s.id)] = s; });
    return map;
  }, [sources]);

  const components = useMemo(() => ({
    citeref: ({ node, children }) => {
      // Read the citation number defensively from properties or the text child.
      const n = node?.properties?.dataCite
        ?? node?.properties?.['data-cite']
        ?? (Array.isArray(children) ? children.join('') : children);
      const source = sourceById[String(n)];
      return (
        <button
          type="button"
          className={`cite-marker${source ? '' : ' cite-marker-dead'}`}
          title={source ? `${source.title}${source.page ? ` — page ${source.page}` : ''}` : `Reference ${n}`}
          onClick={() => source && onOpenSource(source)}
        >
          {n}
        </button>
      );
    },
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
  }), [sourceById, onOpenSource]);

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeCitations]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Example questions for the empty state
 * ------------------------------------------------------------------ */
const EXAMPLE_PROMPTS = [
  'What are the penalties for smoking in public places?',
  'Summarize the anti-jaywalking ordinance.',
  'What are the requirements to get a business permit?',
  'Are there rules on noise levels or videoke hours?',
];

const GREETING = {
  sender: 'ai',
  text: "Hello — I'm **Batas**, your ordinance research assistant. Ask me anything about the local laws and ordinances loaded into my library, and I'll answer with citations you can open and verify.",
  citations: [],
};

function App() {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeModel, setActiveModel] = useState('Loading model…');
  const [isReady, setIsReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSource, setActiveSource] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('batas_theme')
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch { return 'light'; }
  });

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  /* Theme */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('batas_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const getSessionId = () => {
    let id = localStorage.getItem('batas_session_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('batas_session_id', id);
    }
    return id;
  };
  const [sessionId] = useState(getSessionId());

  /* Poll system status */
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/model`);
        const data = await res.json();
        if (stop) return;
        setActiveModel(data.model || 'Unknown model');
        if (data.isInitializing) {
          setTimeout(check, 5000);
        } else {
          setIsReady(true);
        }
      } catch {
        if (!stop) setTimeout(check, 6000);
      }
    };
    check();
    return () => { stop = true; };
  }, [API_URL]);

  /* Load history (restores citations too) */
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/api/history/${sessionId}`);
        if (!res.ok) return;
        const past = await res.json();
        if (past.length > 0) {
          const loaded = [GREETING];
          past.forEach((chat) => {
            loaded.push({ sender: 'user', text: chat.question });
            loaded.push({ sender: 'ai', text: chat.answer, citations: chat.sources || [] });
          });
          setMessages(loaded);
        }
      } catch { /* ignore */ }
    };
    fetchHistory();
  }, [sessionId, API_URL]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages, isLoading]);

  const handleClearChat = async () => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await fetch(`${API_URL}/api/history/${sessionId}`, { method: 'DELETE' });
      setMessages([GREETING]);
      setActiveSource(null);
      setSidebarOpen(false);
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  };

  const sendQuestion = useCallback(async (question) => {
    const q = question.trim();
    if (!q || isLoading || !isReady) return;

    setMessages((prev) => [...prev, { sender: 'user', text: q }]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sessionId }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, {
        sender: 'ai',
        text: data.answer || "I couldn't generate a response.",
        citations: data.sources || [],
      }]);
    } catch {
      setMessages((prev) => [...prev, { sender: 'ai', text: 'Error: cannot reach the Batas backend.', citations: [] }]);
    } finally {
      setIsLoading(false);
    }
  }, [API_URL, sessionId, isLoading, isReady]);

  const handleAsk = (e) => { e.preventDefault(); sendQuestion(input); };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `Uploaded document: ${file.name}` },
      { sender: 'ai', text: `Analyzing **${file.name}**… indexing the legal text, one moment.`, citations: [] },
    ]);
    setIsLoading(true);
    setSidebarOpen(false);

    try {
      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, {
          sender: 'ai',
          text: `Successfully indexed **${file.name}**. It's now part of my active library — ask me anything about it.`,
          citations: [],
        }]);
      } else {
        setMessages((prev) => [...prev, { sender: 'ai', text: `Error: ${data.error}`, citations: [] }]);
      }
    } catch {
      setMessages((prev) => [...prev, { sender: 'ai', text: 'Failed to connect to the server for upload.', citations: [] }]);
    } finally {
      setIsLoading(false);
      e.target.value = null;
    }
  };

  const openSource = useCallback((source) => {
    setActiveSource(source);
  }, []);

  const showEmptyState = messages.length <= 1 && !isLoading;

  return (
    <div className={`workspace${activeSource ? ' with-panel' : ''}`}>

      {/* Mobile overlay for sidebar */}
      <div className={`scrim${sidebarOpen ? ' show' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* ================= SIDEBAR ================= */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Icon.scale /></span>
          <span className="brand-name">Batas</span>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon.close />
          </button>
        </div>

        <button className="btn btn-primary new-chat" onClick={handleClearChat}>
          <Icon.plus /> New conversation
        </button>

        <div className="sidebar-section">
          <div className="sidebar-label">Try asking</div>
          <div className="prompt-list">
            {EXAMPLE_PROMPTS.map((p, i) => (
              <button
                key={i}
                className="prompt-item"
                disabled={!isReady || isLoading}
                onClick={() => { setSidebarOpen(false); sendQuestion(p); }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <input type="file" accept=".pdf" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
          <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()} disabled={!isReady || isLoading}>
            <Icon.upload /> {isLoading ? 'Processing…' : 'Upload ordinance PDF'}
          </button>
          <div className="model-badge" title="Active language model">
            <span className={`status-dot${isReady ? ' ok' : ''}`} />
            <span className="model-text">{isReady ? activeModel : 'Warming up…'}</span>
          </div>
        </div>
      </aside>

      {/* ================= CONVERSATION ================= */}
      <main className="conversation">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon.menu />
          </button>
          <div className="topbar-title">
            <h1>Ordinance Analysis</h1>
            <p>Grounded answers with verifiable citations</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              {theme === 'dark' ? <Icon.sun /> : <Icon.moon />}
            </button>
            <a className="icon-btn" href="https://github.com/Ecila-01/Batas-AI" target="_blank" rel="noopener noreferrer" title="View source">
              <Icon.github />
            </a>
          </div>
        </header>

        <div className="chat-scroll">
          <div className="chat-inner">
            {messages.map((msg, index) => (
              <div key={index} className={`msg ${msg.sender}`}>
                <div className={`avatar ${msg.sender}`}>
                  {msg.sender === 'ai' ? <Icon.scale /> : <Icon.user />}
                </div>
                <div className="msg-body">
                  {msg.sender === 'ai' ? (
                    <>
                      <MarkdownMessage text={msg.text} sources={msg.citations} onOpenSource={openSource} />
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="sources">
                          <div className="sources-label">Sources</div>
                          <div className="source-chips">
                            {msg.citations.map((cite) => (
                              <button
                                key={cite.id}
                                className={`source-chip${activeSource && activeSource.url === cite.url && activeSource.page === cite.page ? ' active' : ''}`}
                                onClick={() => openSource(cite)}
                              >
                                <span className="chip-num">{cite.id}</span>
                                <Icon.doc className="chip-doc" />
                                <span className="chip-title">{cite.title}</span>
                                {cite.page && <span className="chip-page">p.{cite.page}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="user-bubble">{msg.text}</div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="msg ai">
                <div className="avatar ai"><Icon.scale /></div>
                <div className="msg-body">
                  <div className="typing"><span /><span /><span /></div>
                </div>
              </div>
            )}

            {showEmptyState && (
              <div className="empty-state">
                <div className="empty-grid">
                  {EXAMPLE_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      className="empty-card"
                      disabled={!isReady}
                      onClick={() => sendQuestion(p)}
                    >
                      <Icon.doc className="empty-card-icon" />
                      <span>{p}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="composer">
          <form onSubmit={handleAsk} className="composer-form">
            <input
              ref={inputRef}
              type="text"
              placeholder={isReady ? 'Ask about an ordinance…' : 'Batas is initializing — one moment…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading || !isReady}
            />
            <button type="submit" className="send-btn" disabled={isLoading || !input.trim() || !isReady} aria-label="Send">
              <Icon.send />
            </button>
          </form>
          <p className="disclaimer">
            Batas can make mistakes. Verify critical legal information against the cited source or with a licensed attorney.
          </p>
        </footer>
      </main>

      {/* ================= SOURCE READER PANEL ================= */}
      {activeSource && (
        <SourcePanel source={activeSource} onClose={() => setActiveSource(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Source reader — master/detail panel (desktop) / sheet (mobile)
 * ------------------------------------------------------------------ */
function SourcePanel({ source, onClose }) {
  const pdfSrc = source.url ? `${source.url}${source.page ? `#page=${source.page}` : ''}` : null;
  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="source-panel" role="dialog" aria-label="Source document">
        <div className="panel-head">
          <div className="panel-head-text">
            <div className="panel-eyebrow">Source {source.id}{source.page ? ` · page ${source.page}` : ''}</div>
            <div className="panel-title">{source.title}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close source">
            <Icon.close />
          </button>
        </div>

        {source.snippet && (
          <div className="panel-snippet">
            <div className="snippet-label">Cited passage</div>
            <p>“{source.snippet}{source.snippet.length >= 280 ? '…' : ''}”</p>
          </div>
        )}

        <div className="panel-viewer">
          {pdfSrc ? (
            <iframe src={pdfSrc} title={source.title} />
          ) : (
            <div className="panel-noviewer">No source PDF is linked for this citation.</div>
          )}
        </div>

        {source.url && (
          <div className="panel-foot">
            <a className="btn btn-ghost" href={source.url} target="_blank" rel="noopener noreferrer">
              <Icon.external /> Open full PDF
            </a>
          </div>
        )}
      </aside>
    </>
  );
}

export default App;
