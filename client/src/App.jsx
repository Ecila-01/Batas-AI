import React, { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    { sender: 'ai', text: 'Hello! I am Batas, your AI Ordinance Navigator. How can I assist you with local laws today?', citations: [] }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeModel, setActiveModel] = useState('Loading Model...');
  const [isReady, setIsReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Batas AI is initializing database...");
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar state
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pdfModal, setPdfModal] = useState(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const getSessionId = () => {
    let id = localStorage.getItem('batas_session_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('batas_session_id', id);
    }
    return id;
  };

  const [sessionId] = useState(getSessionId());

  useEffect(() => {
    const checkSystemStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/model`);
        const data = await response.json();
        if (data.isInitializing) {
          setTimeout(checkSystemStatus, 5000);
        } else {
          setIsReady(true);
          setStatusMessage("Ask a question about Baguio Ordinances...");
        }
      } catch (error) {
        console.error("Status check failed", error);
      }
    };
    checkSystemStatus();
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/api/history/${sessionId}`);
        if (response.ok) {
          const pastChats = await response.json();
          if (pastChats.length > 0) {
            const loadedMessages = [
              { sender: 'ai', text: 'Hello! I am Batas, your AI Ordinance Navigator. How can I assist you with local laws today?', citations: [] }
            ];
            pastChats.forEach(chat => {
              loadedMessages.push({ sender: 'user', text: chat.question });
              loadedMessages.push({ sender: 'ai', text: chat.answer, citations: [] });
            });
            setMessages(loadedMessages);
          }
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
      }
    };

    const fetchModel = async () => {
      try {
        const response = await fetch(`${API_URL}/api/model`);
        if (response.ok) {
          const data = await response.json();
          setActiveModel(data.model);
        }
      } catch (error) {
        console.error("Error fetching model:", error);
        setActiveModel('Unknown Model');
      }
    };

    fetchHistory();
    fetchModel();
  }, [sessionId, API_URL]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to delete this conversation? This cannot be undone.")) return;
    try {
      await fetch(`${API_URL}/api/history/${sessionId}`, { method: 'DELETE' });
      setMessages([{ sender: 'ai', text: 'Hello! I am Batas, your AI Ordinance Navigator. How can I assist you with local laws today?', citations: [] }]);
      setSidebarOpen(false);
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  };

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userQuestion = input;
    setMessages((prev) => [...prev, { sender: 'user', text: userQuestion }]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userQuestion, sessionId: sessionId }),
      });

      const data = await response.json();

      setMessages((prev) => [...prev, {
        sender: 'ai',
        text: data.answer || "I couldn't generate a response.",
        citations: data.sources || []
      }]);
    } catch (error) {
      setMessages((prev) => [...prev, { sender: 'ai', text: 'Error: Cannot reach the Batas backend.', citations: [] }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `Uploaded document: ${file.name}` },
      { sender: 'ai', text: `Analyzing ${file.name}... Please wait a moment while I index the legal text.`, citations: [] }
    ]);
    setIsLoading(true);
    setSidebarOpen(false); // Close sidebar after triggering upload on mobile

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessages((prev) => [
          ...prev,
          { sender: 'ai', text: `✅ Successfully indexed "${file.name}". It is now part of my active knowledge base. What would you like to know about it?`, citations: [] }
        ]);
      } else {
        setMessages((prev) => [...prev, { sender: 'ai', text: `❌ Error: ${data.error}`, citations: [] }]);
      }
    } catch (error) {
      setMessages((prev) => [...prev, { sender: 'ai', text: '❌ Failed to connect to the server for upload.', citations: [] }]);
    } finally {
      setIsLoading(false);
      e.target.value = null;
    }
  };

  return (
    <div className="app-container">

      {/* Mobile sidebar overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-with-text-container">
            <svg className="logo-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 16c0 1.105-1.79 2-4 2s-4-.895-4-2" />
              <path d="M12 2v16" />
              <path d="M4 7h16" />
              <path d="M4 7l4 9" />
              <path d="M20 7l-4 9" />
              <path d="M9 22h6" />
            </svg>
            <span className="logo-text-ai">Batas AI</span>
          </div>
        </div>

        <div className="sidebar-spacer"></div>

        <div className="sidebar-footer">
          <input
            type="file"
            accept=".pdf"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button className="sidebar-clear-btn" onClick={handleClearChat}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete Conversation
          </button>

          <button
            className="sidebar-upload-btn"
            onClick={() => fileInputRef.current.click()}
            disabled={!isReady || isLoading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            {isLoading ? 'Processing...' : 'Upload Document'}
          </button>
        </div>
      </aside>

      <main className="main-content">

        {/* TOPBAR */}
        <header className="topbar">
          {/* Hamburger — only visible on mobile */}
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          <div className="topbar-info">
            <h3>Legal Ordinance Analysis</h3>
            <div className="status-indicator">
              <span className="dot active"></span>
              <span className="status-text">System Active • {activeModel}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <a href="https://github.com/Ecila-01/Batas-AI" target="_blank" rel="noopener noreferrer" className="github-btn" title="View Source Code">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
              <span>View Source</span>
            </a>
          </div>
        </header>

        {/* CHAT WINDOW */}
        <div className="chat-window">
          {messages.map((msg, index) => (
            <div key={index} className={`message-wrapper ${msg.sender}`}>

              {msg.sender === 'ai' ? (
                <div className="message-avatar ai">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 16c0 1.105-1.79 2-4 2s-4-.895-4-2" />
                    <path d="M12 2v16" />
                    <path d="M4 7h16" />
                    <path d="M4 7l4 9" />
                    <path d="M20 7l-4 9" />
                    <path d="M9 22h6" />
                  </svg>
                </div>
              ) : (
                <div className="message-avatar user">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
              )}

              <div className="message-content">
                <div className={`message-bubble ${msg.sender}`}>
                  {msg.text}
                </div>
                {msg.sender === 'ai' && msg.citations && msg.citations.length > 0 && (
                  <div className="citation-container">
                    {msg.citations.map((cite, i) => (
                      <span
                        key={i}
                        className="citation-chip"
                        onClick={() => cite.url && setPdfModal(cite)}
                        style={{ cursor: cite.url ? 'pointer' : 'default' }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        {cite.name || cite}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message-wrapper ai">
              <div className="message-avatar ai">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 16c0 1.105-1.79 2-4 2s-4-.895-4-2" />
                  <path d="M12 2v16" />
                  <path d="M4 7h16" />
                  <path d="M4 7l4 9" />
                  <path d="M20 7l-4 9" />
                  <path d="M9 22h6" />
                </svg>
              </div>
              <div className="message-bubble ai loading">
                <span className="load-dot"></span>
                <span className="load-dot"></span>
                <span className="load-dot"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <footer className="input-area">
          <form onSubmit={handleAsk} className="input-form">
            <input
              type="text"
              placeholder={isReady ? "Ask a question about the loaded ordinances..." : "Batas AI is initializing, please wait..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading || !isReady}
            />
            <button type="submit" className="send-btn" disabled={isLoading || !input.trim() || !isReady}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </form>
          <p className="disclaimer-text">
            Batas AI generates responses based on loaded documents. Responses may contain inaccuracies. Verify critical information with a licensed attorney or official records.
          </p>
        </footer>
      </main>

      {/* PDF MODAL */}
      {pdfModal && (
        <div className="pdf-modal-overlay" onClick={() => setPdfModal(null)}>
          <div className="pdf-modal" onClick={e => e.stopPropagation()}>
            <div className="pdf-modal-header">
              <span>{pdfModal.name}</span>
              <button onClick={() => setPdfModal(null)}>✕</button>
            </div>
            <iframe
              src={pdfModal.url}
              className="pdf-modal-iframe"
              title={pdfModal.name}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;