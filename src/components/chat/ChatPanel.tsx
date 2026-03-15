import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Send, Sparkles, LogIn, Loader2, Plus, History, Trash2, ArrowLeft, Square } from 'lucide-react';
import PaiMascot from './PaiMascot';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface ChatSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export default function ChatPanel() {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');
  const [model, setModelState] = useState(() => localStorage.getItem('pai-model') || 'gpt-4o');
  const setModel = (m: string) => { setModelState(m); localStorage.setItem('pai-model', m); };
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const modelRef = useRef<HTMLDivElement>(null);

  const { data: availableModels = [] } = useQuery({
    queryKey: ['chat-models'],
    queryFn: () => api.get<string[]>('/chat/models'),
    staleTime: 300_000,
  });

  const filteredModels = modelFilter
    ? availableModels.filter(m => m.toLowerCase().includes(modelFilter.toLowerCase()))
    : availableModels;

  // Close model picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
        setModelFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [promptIdx, setPromptIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: authStatus } = useQuery({
    queryKey: ['chat-auth'],
    queryFn: () => api.get<{ authenticated: boolean }>('/chat/auth'),
    refetchInterval: authPending ? 3000 : false,
  });

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: () => api.get<ChatSession[]>('/chat/sessions'),
  });

  const authenticated = authStatus?.authenticated ?? false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (authenticated && authPending) setAuthPending(false);
  }, [authenticated, authPending]);

  // Ctrl+N inside chat panel = new session
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n' && panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        newSession();
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase to beat notes handler
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Load prompt history from all sessions on mount
  useEffect(() => {
    loadPromptHistory();
  }, []);

  async function loadPromptHistory() {
    try {
      const sessions = await api.get<ChatSession[]>('/chat/sessions');
      const allPrompts: string[] = [];
      for (const s of sessions.slice(0, 20)) {
        const full = await api.get<{ messages: { role: string; content: string }[] }>(`/chat/sessions/${s.id}`);
        for (const m of full.messages) {
          if (m.role === 'user' && !allPrompts.includes(m.content)) {
            allPrompts.push(m.content);
          }
        }
      }
      setPromptHistory(allPrompts.reverse()); // most recent first
    } catch { }
  }

  // Load a session's messages
  async function loadSession(id: number) {
    try {
      const data = await api.get<{ messages: Message[] }>(`/chat/sessions/${id}`);
      setSessionId(id);
      setMessages(data.messages.map((m: any) => ({ ...m, timestamp: m.createdAt || m.timestamp })));
      setShowHistory(false);
    } catch { }
  }

  // Create a new session
  async function newSession() {
    setSessionId(null);
    setMessages([]);
    setShowHistory(false);
    inputRef.current?.focus();
  }

  // Ensure we have a session, create one if needed
  async function ensureSession(): Promise<number> {
    if (sessionId) return sessionId;
    const session = await api.post<ChatSession>('/chat/sessions', {});
    setSessionId(session.id);
    refetchSessions();
    return session.id;
  }

  // Save a message to the current session
  async function saveMessage(sid: number, role: string, content: string) {
    await api.post(`/chat/sessions/${sid}/messages`, { role, content });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/chat/sessions/${id}`),
    onSuccess: (_, id) => {
      if (sessionId === id) newSession();
      refetchSessions();
    },
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      const result = await api.post<{
        device_code: string; user_code: string;
        verification_uri: string; interval: number;
      }>('/chat/auth/start');

      window.open(result.verification_uri, '_blank');
      setAuthPending(true);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `To sign in with GitHub, enter code **${result.user_code}** at the page that just opened.\n\nI'll connect automatically once you authorize.`,
      }]);

      try {
        await api.post('/chat/auth/poll', {
          device_code: result.device_code,
          interval: result.interval,
        });
        qc.invalidateQueries({ queryKey: ['chat-auth'] });
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "Connected to GitHub Copilot! How can I help you today?",
        }]);
      } catch (err: any) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Auth failed: ${err.message}. Please try again.`,
        }]);
      }
      setAuthPending(false);
    },
  });

  const stopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreaming(false);
    // Remove thinking indicator if still showing
    setMessages(prev => prev.filter(m => m.content !== ':::thinking:::'));
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;

    // If already streaming, stop it first
    if (streaming) stopStreaming();

    // Add to prompt history (most recent first, deduplicated)
    setPromptHistory(prev => {
      const updated = [text, ...prev.filter(p => p !== text)];
      return updated.slice(0, 100); // cap at 100
    });
    setPromptIdx(-1);

    const now = new Date().toISOString();
    // Clean any leftover thinking indicators before adding new messages
    const cleanMessages = messages.filter(m => m.content !== ':::thinking:::');
    const newMessages: Message[] = [...cleanMessages, { role: 'user', content: text, timestamp: now }];
    setMessages([...newMessages, { role: 'assistant', content: ':::thinking:::', timestamp: now }]);
    setInput('');
    setStreaming(true);

    // Ensure session exists and save user message
    const sid = await ensureSession();
    await saveMessage(sid, 'user', text);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          model,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Chat request failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let assistantMsg = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                assistantMsg += parsed.content;
                setMessages(prev => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() };
                  return copy;
                });
              }
              if (parsed.actions) {
                for (const action of parsed.actions) {
                  if (action.type?.startsWith('add_note') || action.type === 'list_notes')
                    qc.invalidateQueries({ queryKey: ['notes'] });
                  if (action.type?.startsWith('add_task') || action.type === 'list_tasks')
                    qc.invalidateQueries({ queryKey: ['tasks'] });
                  if (action.type?.startsWith('add_reminder') || action.type === 'list_reminders')
                    qc.invalidateQueries({ queryKey: ['reminders'] });
                  if (action.type?.startsWith('add_reading'))
                    qc.invalidateQueries({ queryKey: ['reading'] });
                  qc.invalidateQueries({ queryKey: ['dashboard'] });
                }
              }
              if (parsed.replace !== undefined) {
                assistantMsg = parsed.replace;
                setMessages(prev => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() };
                  return copy;
                });
              }
            } catch { }
          }
        }
      }

      // Save assistant response
      if (assistantMsg) {
        await saveMessage(sid, 'assistant', assistantMsg);
        refetchSessions();
      }
    } catch (err: any) {
      try {
        const result = await api.post<{ reply: string }>('/chat', {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          model,
        });
        setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
        await saveMessage(sid, 'assistant', result.reply);
        refetchSessions();
      } catch (err2: any) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Sorry, I couldn't process that: ${err2.message}`,
        }]);
      }
    }

    setStreaming(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Up arrow cycles through prompt history
    if (e.key === 'ArrowUp' && promptHistory.length > 0) {
      const textarea = e.target as HTMLTextAreaElement;
      // Only cycle history when cursor is at the start (or input is empty)
      if (textarea.selectionStart === 0 || !input || promptIdx >= 0) {
        e.preventDefault();
        const newIdx = promptIdx + 1;
        if (newIdx < promptHistory.length) {
          setPromptIdx(newIdx);
          setInput(promptHistory[newIdx]);
        }
      }
    }
    if (e.key === 'ArrowDown' && promptIdx >= 0) {
      e.preventDefault();
      const newIdx = promptIdx - 1;
      if (newIdx >= 0) {
        setPromptIdx(newIdx);
        setInput(promptHistory[newIdx]);
      } else {
        setPromptIdx(-1);
        setInput('');
      }
    }
  };

  // History view
  if (showHistory) {
    const filtered = historyFilter
      ? sessions.filter(s => s.title.toLowerCase().includes(historyFilter.toLowerCase()))
      : sessions;

    return (
      <div className="chat-panel" ref={panelRef}>
        <div className="chat-history-header">
          <button className="ghost" onClick={() => { setShowHistory(false); setHistoryFilter(''); }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={newSession} style={{ padding: '4px 12px', fontSize: 12 }}>
            <Plus size={14} /> New Chat
          </button>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input
            placeholder="Filter chats..."
            value={historyFilter}
            onChange={e => setHistoryFilter(e.target.value)}
            style={{ width: '100%', fontSize: 13 }}
            autoFocus
          />
        </div>
        <div className="chat-history-list">
          {filtered.map(s => (
            <div key={s.id} className="chat-history-item" onClick={() => loadSession(s.id)}>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</div>
                <div className="text-xs text-muted">{new Date(s.updatedAt).toLocaleString()}</div>
              </div>
              <button className="ghost" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(s.id); }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-muted text-small" style={{ padding: 16 }}>
              {historyFilter ? 'No matches' : 'No chat history yet'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel" ref={panelRef}>
      {/* Mini toolbar */}
      <div className="chat-toolbar">
        <button className="ghost" onClick={() => setShowHistory(true)} title="Chat history">
          <History size={14} />
        </button>
        <button className="ghost" onClick={newSession} title="New chat (Ctrl+N)">
          <Plus size={14} />
        </button>
        <div className="model-picker" ref={modelRef}>
          <button
            className="model-picker-btn"
            onClick={() => { setModelOpen(!modelOpen); setModelFilter(''); }}
            title="Select AI model"
          >
            {model}
          </button>
          {modelOpen && (
            <div className="model-picker-dropdown">
              <input
                className="model-picker-search"
                placeholder="Search models..."
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value)}
                autoFocus
              />
              <div className="model-picker-list">
                {filteredModels.map(m => (
                  <div
                    key={m}
                    className={`model-picker-item ${m === model ? 'active' : ''}`}
                    onClick={() => { setModel(m); setModelOpen(false); setModelFilter(''); }}
                  >
                    {m}
                  </div>
                ))}
                {filteredModels.length === 0 && (
                  <div className="text-muted text-xs" style={{ padding: 8 }}>No matches</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <PaiMascot size={90} />
            <h2>Hi, I'm Pai</h2>
            <p>Your personal AI. Manage tasks, notes, reminders, search emails, or just chat.</p>
            {!authenticated && (
              <button
                className="chat-login-btn"
                onClick={() => loginMutation.mutate()}
                disabled={loginMutation.isPending || authPending}
              >
                <LogIn size={16} />
                {authPending ? 'Waiting...' : 'Sign in with GitHub'}
              </button>
            )}
            <div className="chat-suggestions">
              <button className="chat-suggestion" onClick={() => setInput('What should I focus on today?')}>
                What should I focus on today?
              </button>
              <button className="chat-suggestion" onClick={() => setInput('Help me plan my week')}>
                Help me plan my week
              </button>
              <button className="chat-suggestion" onClick={() => setInput('Summarize my recent emails')}>
                Summarize my recent emails
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Thinking indicator
          if (msg.content === ':::thinking:::') {
            return (
              <div key={i} className="chat-bubble assistant">
                <div className="chat-avatar">
                  <PaiMascot size={24} />
                </div>
                <div className="chat-thinking">
                  <div className="thinking-dots">
                    <span /><span /><span />
                  </div>
                  <span className="thinking-label">Thinking...</span>
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={`chat-bubble ${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="chat-avatar">
                  <PaiMascot size={24} />
                </div>
              )}
              <div>
                <div className="chat-bubble-content">
                  {msg.content.split('\n').map((line, j) => (
                    <p key={j}>{renderMarkdownLine(line)}</p>
                  ))}
                  {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                    <span className="chat-cursor" />
                  )}
                </div>
                {msg.timestamp && (
                  <div className={`chat-timestamp ${msg.role}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setPromptIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder={authenticated ? 'Ask me anything... (↑ for history)' : 'Sign in with GitHub to chat'}
          disabled={!authenticated && !authPending}
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || !authenticated}
          className="chat-send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

function renderMarkdownLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    const matches = [boldMatch, codeMatch].filter(Boolean).sort((a, b) => a!.index! - b!.index!);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const match = matches[0]!;
    const idx = match.index!;

    if (idx > 0) parts.push(remaining.substring(0, idx));

    if (match[0].startsWith('**')) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      parts.push(<code key={key++} className="inline-code">{match[1]}</code>);
    }

    remaining = remaining.substring(idx + match[0].length);
  }

  return parts.length > 0 ? parts : line || '\u00A0';
}
