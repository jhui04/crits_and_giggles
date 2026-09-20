import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AssistantMarkdown } from './AssistantMarkdown';

interface Message {
  id: string;
  sender: 'user' | 'oracle';
  text: string;
  passages?: Array<{ title: string; content: string }>;
  toolCalls?: Array<{ toolName: string; args: unknown; result?: unknown }>;
  modelUsed?: string;
  timestamp: string;
}

interface AssistantOracleModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId?: string | null;
  encounterId?: string | null;
  initialFocusOnInput?: boolean;
}

function formatTimestamp(date: Date = new Date()): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getModelDisplayName(model: string): string {
  if (model === 'qwen3.5:9b') return 'Qwen3.5-9B';
  if (model === 'qwen3.5:4b') return 'Qwen3.5-4B';
  if (model === 'llama3' || model === 'llama3:8b' || model === 'llama3:latest') return 'Llama 3 (8B)';
  return model;
}

export function AssistantOracleModal({
  isOpen,
  onClose,
  campaignId = null,
  encounterId = null,
  initialFocusOnInput = false,
}: AssistantOracleModalProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'oracle',
      text: '**Greetings, Dungeon Master.** I am your Assistant Oracle, grounded in official **SRD 5.2.1** rules and your active campaign state. Ask any rules question or check live combat HP and initiative.',
      timestamp: formatTimestamp(),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeModel, setActiveModel] = useState('qwen3.5:9b');

  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch active model config on mount
  useEffect(() => {
    if (isOpen) {
      fetch('/api/assistant/config')
        .then((res) => res.json())
        .then((data) => {
          if (data.activeModel) setActiveModel(data.activeModel);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Focus management when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (initialFocusOnInput && inputRef.current) {
          inputRef.current.focus();
        } else if (headingRef.current) {
          headingRef.current.focus();
        }
      }, 30);
    }
  }, [isOpen, initialFocusOnInput]);

  // Auto-scroll conversation log
  useEffect(() => {
    if (isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Modal focus trap & Escape handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first || document.activeElement === headingRef.current || !modalRef.current.contains(document.activeElement)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }
    },
    [onClose]
  );

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setActiveModel(newModel);
    try {
      await fetch('/api/assistant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModel: newModel }),
      });
    } catch {
      // Ignored
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (!query || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: formatTimestamp(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputQuery('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          campaignId,
          encounterId,
          model: activeModel,
        }),
      });

      const data = await res.json();
      const oracleMessage: Message = {
        id: `oracle-${Date.now()}`,
        sender: 'oracle',
        text: data.answer || 'No response received from the Oracle.',
        passages: data.passages,
        toolCalls: data.toolCalls,
        modelUsed: data.modelUsed || activeModel,
        timestamp: formatTimestamp(),
      };

      setMessages((prev) => [...prev, oracleMessage]);
      setTimeout(() => {
        const el = document.getElementById(oracleMessage.id);
        if (el) {
          el.focus();
        }
      }, 50);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorMsgId = `oracle-error-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: errorMsgId,
          sender: 'oracle',
          text: `**Error communicating with Oracle**: ${errorMessage}`,
          timestamp: formatTimestamp(),
        },
      ]);
      setTimeout(() => {
        const el = document.getElementById(errorMsgId);
        if (el) el.focus();
        else inputRef.current?.focus();
      }, 50);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay assistant-oracle-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-oracle-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 3500,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem',
      }}
    >
      <div
        ref={modalRef}
        className="modal-content assistant-oracle-content dark-theme"
        style={{
          backgroundColor: '#1a1a1a',
          color: '#f0f0f0',
          padding: '1.5rem',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '850px',
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          border: '2px solid #555',
          boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <h2
              id="assistant-oracle-title"
              ref={headingRef}
              tabIndex={-1}
              style={{ margin: 0, outline: 'none', fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <span>The Assistant Oracle</span>
              <span style={{ fontSize: '0.8rem', background: '#0066cc', color: 'white', padding: '0.1rem 0.5rem', borderRadius: '4px', fontWeight: 'normal' }}>
                Local AI (SRD 5.2.1)
              </span>
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Assistant Oracle"
            style={{
              background: '#444',
              color: 'white',
              border: 'none',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Close (Esc)
          </button>
        </div>

        {/* Conversation Log */}
        <div
          role="log"
          aria-label="Assistant Oracle Conversation History"
          style={{
            flex: 1,
            overflowY: 'auto',
            background: '#111',
            borderRadius: '6px',
            padding: '1rem',
            marginBottom: '1rem',
            border: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {messages.map((msg) => (
            <article
              key={msg.id}
              id={msg.id}
              tabIndex={msg.sender === 'oracle' ? -1 : undefined}
              className={`chat-message ${msg.sender === 'user' ? 'user-message' : 'oracle-message'}`}
              style={{
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor: msg.sender === 'user' ? '#004c99' : '#222',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: msg.sender === 'user' ? '1px solid #0066cc' : '1px solid #444',
                outline: 'none',
              }}
            >
              <header style={{ marginBottom: '0.35rem', fontSize: '0.8rem', color: '#bbb' }}>
                <span style={{ fontWeight: 'bold' }}>
                  {msg.sender === 'user' ? 'You' : 'Oracle'} {msg.timestamp}
                </span>
              </header>

              {msg.sender === 'user' ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
              ) : (
                <>
                  <AssistantMarkdown content={msg.text} />

                  {/* Executed Tools Disclosure */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <details style={{ marginTop: '0.75rem', fontSize: '0.85rem', background: '#181818', padding: '0.5rem', borderRadius: '4px', border: '1px solid #333' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#4da6ff' }}>
                        Authoritative Data Reads Executed ({msg.toolCalls.length})
                      </summary>
                      <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
                        {msg.toolCalls.map((tc, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>
                            <code>{tc.toolName}</code> with args <code>{JSON.stringify(tc.args)}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Retrieved Knowledge Passages Disclosure */}
                  {msg.passages && msg.passages.length > 0 && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.85rem', background: '#181818', padding: '0.5rem', borderRadius: '4px', border: '1px solid #333' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a6e22e' }}>
                        Knowledge Passages Retrieved ({msg.passages.length})
                      </summary>
                      <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
                        {msg.passages.map((p, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>
                            <strong>{p.title}</strong>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </article>
          ))}

          {isLoading && (
            <div
              role="status"
              aria-live="polite"
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#222',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid #444',
                color: '#aaa',
                fontStyle: 'italic',
              }}
            >
              The Oracle is contemplating...
            </div>
          )}

          <div ref={logEndRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
          <label htmlFor="assistant-oracle-input" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
            Ask the Oracle a rules or game state question
          </label>
          <textarea
            id="assistant-oracle-input"
            ref={inputRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask rules, spells, monsters, or live state (Alt+A to focus, Enter to send)..."
            rows={2}
            disabled={isLoading}
            style={{
              flex: 1,
              background: '#2a2a2a',
              color: 'white',
              border: '1px solid #555',
              borderRadius: '4px',
              padding: '0.6rem 0.8rem',
              fontSize: '1rem',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !inputQuery.trim()}
            style={{
              backgroundColor: isLoading || !inputQuery.trim() ? '#444' : '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '0 1.5rem',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: isLoading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Asking...' : 'Ask'}
          </button>
        </form>

        {/* Model Selection Combo Box under edit box and send button */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
          <select
            id="assistant-model-select"
            value={activeModel}
            onChange={handleModelChange}
            aria-label={`Current Model: ${getModelDisplayName(activeModel)}`}
            style={{
              background: '#222',
              color: '#ccc',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '0.25rem 0.6rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <option value="qwen3.5:9b">Qwen3.5-9B (Primary - ~6GB VRAM)</option>
            <option value="qwen3.5:4b">Qwen3.5-4B (Fallback - ~3GB VRAM)</option>
            <option value="llama3">Llama 3 (8B) - ~5.5GB VRAM</option>
          </select>
        </div>
      </div>
    </div>
  );
}
