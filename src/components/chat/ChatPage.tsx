import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Send, Sparkles, LogIn, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: authStatus } = useQuery({
    queryKey: ['chat-auth'],
    queryFn: () => api.get<{ authenticated: boolean }>('/chat/auth'),
    refetchInterval: authPending ? 3000 : false,
  });

  const authenticated = authStatus?.authenticated ?? false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (authenticated && authPending) setAuthPending(false);
  }, [authenticated, authPending]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const result = await api.post<{
        device_code: string; user_code: string;
        verification_uri: string; interval: number;
      }>('/chat/auth/start');

      // Open browser for auth
      window.open(result.verification_uri, '_blank');
      setAuthPending(true);

      // Show the code to the user
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `To sign in with GitHub, enter code **${result.user_code}** at the page that just opened.\n\nI'll connect automatically once you authorize.`,
      }]);

      // Poll for token in background
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

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    try {
      // Use streaming endpoint
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Chat request failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let assistantMsg = '';

      // Add empty assistant message that we'll fill
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

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
                  copy[copy.length - 1] = { role: 'assistant', content: assistantMsg };
                  return copy;
                });
              }
            } catch { }
          }
        }
      }
    } catch (err: any) {
      // Fallback to non-streaming
      try {
        const result = await api.post<{ reply: string }>('/chat', {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        });
        setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
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
  };

  return (
    <div className="chat-page">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <Sparkles size={32} className="chat-welcome-icon" />
            <h2>Hi Inbar, how can I help?</h2>
            <p>I'm your personal assistant. Ask me anything — manage tasks, set reminders, summarize emails, or just chat.</p>
            {!authenticated && (
              <button
                className="chat-login-btn"
                onClick={() => loginMutation.mutate()}
                disabled={loginMutation.isPending || authPending}
              >
                <LogIn size={16} />
                {authPending ? 'Waiting for authorization...' : 'Sign in with GitHub'}
              </button>
            )}
            <div className="chat-suggestions">
              <button className="chat-suggestion" onClick={() => { setInput('What should I focus on today?'); }}>
                What should I focus on today?
              </button>
              <button className="chat-suggestion" onClick={() => { setInput('Help me plan my week'); }}>
                Help me plan my week
              </button>
              <button className="chat-suggestion" onClick={() => { setInput('Summarize my recent emails'); }}>
                Summarize my recent emails
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar">
                <Sparkles size={14} />
              </div>
            )}
            <div className="chat-bubble-content">
              {msg.content.split('\n').map((line, j) => (
                <p key={j}>{renderMarkdownLine(line)}</p>
              ))}
              {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                <span className="chat-cursor" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={authenticated ? 'Ask me anything...' : 'Sign in with GitHub to start chatting'}
          disabled={!authenticated && !authPending}
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming || !authenticated}
          className="chat-send"
        >
          {streaming ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}

function renderMarkdownLine(line: string): React.ReactNode {
  // Simple inline markdown: **bold**, `code`
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
