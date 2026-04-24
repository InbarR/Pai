import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Send, Sparkles, LogIn, Loader2, Plus, History, Trash2, ArrowLeft, Square, Copy, X, Mic, MicOff, Maximize2, Menu, Brain, Database } from 'lucide-react';
import BrianMascot from './BrianMascot';
import {
  loadCustomPrompts,
  subscribeCustomPrompts,
  findCustomPrompt,
  expandPrompt,
  CustomPrompt,
} from '../../lib/customPrompts';

interface SourceRef {
  label: string;
  kind: string;
  query?: string;
  count?: number;
  items?: any[];
}

interface ThinkingStep {
  text: string;
  atMs: number; // ms since stream start when this status arrived
  durMs?: number; // ms this step took (set when next step arrives or stream ends)
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  thinking?: ThinkingStep[];
  sources?: SourceRef[];
}

interface ChatSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const ALL_SUGGESTIONS = [
  'What should I focus on today?',
  'Help me plan my week',
  'Summarize my recent emails',
  'What meetings do I have today?',
  'Show me my open tasks',
  'Draft a follow-up email',
  'What did I miss yesterday?',
  'Who emailed me recently?',
  'Remind me about something',
  'What\'s on my calendar this week?',
  'Help me prioritize my tasks',
  'Any urgent emails I should handle?',
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function ChatPanel({ onChatFullscreen }: { onChatFullscreen?: () => void } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('brian-session-id');
    return saved ? parseInt(saved) : null;
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('brian-messages') || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>(() => loadCustomPrompts());
  useEffect(() => subscribeCustomPrompts(() => setCustomPrompts(loadCustomPrompts())), []);
  const [pastedImages, setPastedImages] = useState<{ data: string; name: string }[]>([]);
  const [suggestions] = useState(() => pickRandom(ALL_SUGGESTIONS, 3));
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(new Set());
  const historyInputRef = useRef<HTMLInputElement>(null);
  const [model, setModelState] = useState(() => localStorage.getItem('brian-model') || 'gpt-4o');
  const setModel = (m: string) => { setModelState(m); localStorage.setItem('brian-model', m); };
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const modelRef = useRef<HTMLDivElement>(null);

  // Chat text zoom (Ctrl +/- and Ctrl+wheel). Persisted across sessions.
  const ZOOM_MIN = 0.7, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 10) / 10));
  const [zoom, setZoomState] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('brian-chat-zoom') || '');
    return Number.isFinite(saved) ? clampZoom(saved) : 1;
  });
  const setZoom = (z: number) => {
    const v = clampZoom(z);
    setZoomState(v);
    localStorage.setItem('brian-chat-zoom', String(v));
    document.documentElement.style.setProperty('--chat-zoom', String(v));
  };
  const [zoomToast, setZoomToast] = useState<string | null>(null);
  const zoomToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashZoom = (z: number) => {
    setZoomToast(`${Math.round(z * 100)}%`);
    if (zoomToastTimer.current) clearTimeout(zoomToastTimer.current);
    zoomToastTimer.current = setTimeout(() => setZoomToast(null), 900);
  };

  // Ctrl +/- / 0 keyboard handlers, scoped to when the chat panel is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // "+" lives on multiple keys depending on layout; check both code & key.
      const isPlus = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd';
      const isMinus = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract';
      const isZero = e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0';
      if (!isPlus && !isMinus && !isZero) return;
      e.preventDefault();
      setZoomState(prev => {
        const next = isZero ? 1 : clampZoom(prev + (isPlus ? ZOOM_STEP : -ZOOM_STEP));
        localStorage.setItem('brian-chat-zoom', String(next));
        document.documentElement.style.setProperty('--chat-zoom', String(next));
        flashZoom(next);
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    const onFontChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sizePercent?: number } | undefined;
      if (detail && Number.isFinite(detail.sizePercent)) {
        setZoomState(clampZoom((detail.sizePercent as number) / 100));
      }
    };
    window.addEventListener('brian:font-changed', onFontChanged as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('brian:font-changed', onFontChanged as EventListener);
    };
  }, []);

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
  const [voiceActive, setVoiceActive] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [openThinking, setOpenThinking] = useState<Set<number>>(new Set());
  const [openSource, setOpenSource] = useState<string | null>(null); // `${msgIdx}:${srcIdx}`
  const recognitionRef = useRef<any>(null);

  const startVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Voice input is not supported in this browser. Use Chrome or Edge.' }]);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = ''; // auto-detect language
    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      // Show interim results in the input field
      setInput(prev => {
        const base = prev.replace(/\s*\[\.\.\..*\]$/, ''); // remove previous interim
        const combined = (finalTranscript || base) + (interim ? ` [... ${interim}]` : '');
        return combined;
      });
    };

    recognition.onend = () => {
      // Clean up interim markers and set final text
      setInput(prev => {
        const cleaned = prev.replace(/\s*\[\.\.\..*\]$/, '').trim();
        return cleaned;
      });
      setVoiceActive(false);
      recognitionRef.current = null;
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
        inputRef.current.focus();
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Voice error: ${event.error}. Check microphone permissions.` }]);
      }
      setVoiceActive(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setVoiceActive(true);
  };

  const stopVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    recognitionRef.current = null;
    setVoiceActive(false);
  };

  const { data: authStatus, isError: authError } = useQuery({
    queryKey: ['chat-auth'],
    queryFn: () => api.get<{ authenticated: boolean }>('/chat/auth'),
    retry: 5,
    retryDelay: 3000,
    refetchInterval: 60_000,
    refetchInterval: authPending ? 3000 : false,
  });

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: () => api.get<ChatSession[]>('/chat/sessions'),
  });

  // Default to true on error/loading — only show sign-in when server explicitly says not authenticated
  const authenticated = authError ? true : (authStatus?.authenticated ?? true);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (authenticated && authPending) setAuthPending(false);
  }, [authenticated, authPending]);

  // Focus history input when panel opens
  useEffect(() => {
    if (showHistory) {
      setHistoryIdx(-1);
      setTimeout(() => historyInputRef.current?.focus(), 50);
    }
  }, [showHistory]);

  // Scroll highlighted history item into view
  useEffect(() => {
    if (historyIdx >= 0) {
      const el = document.querySelector('.chat-history-item.highlighted');
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [historyIdx]);

  // Chat keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!panelRef.current) return;
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        newSession();
      }
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        setShowHistory(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Listen for "new chat" event from sidebar
  useEffect(() => {
    const handler = () => { newSession(); };
    window.addEventListener('brian-new-chat', handler);
    return () => window.removeEventListener('brian-new-chat', handler);
  }, []);

  // Persist chat state to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('brian-messages', JSON.stringify(
      messages
        .filter(m => m.content !== ':::thinking:::' && !m.content.startsWith(':::status:::'))
    ));
  }, [messages]);
  useEffect(() => {
    if (sessionId) sessionStorage.setItem('brian-session-id', String(sessionId));
  }, [sessionId]);

  // Auto-chat from notification clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg && typeof msg === 'string') {
        // Directly trigger a send by setting input and using a flag
        (window as any).__brianAutoSend = msg;
        setInput(msg);
      }
    };
    window.addEventListener('brian-auto-chat', handler);
    return () => window.removeEventListener('brian-auto-chat', handler);
  }, []);
  // Watch for auto-send flag
  useEffect(() => {
    if ((window as any).__brianAutoSend && input === (window as any).__brianAutoSend) {
      delete (window as any).__brianAutoSend;
      sendMessage();
    }
  }, [input]);

  // Load prompt history from all sessions on mount
  useEffect(() => {
    loadPromptHistory();
  }, []);

  async function loadPromptHistory() {
    try {
      const sessions = await api.get<ChatSession[]>('/chat/sessions');
      // Sessions are already sorted newest first
      const allPrompts: string[] = [];
      for (const s of sessions.slice(0, 20)) {
        const full = await api.get<{ messages: { role: string; content: string }[] }>(`/chat/sessions/${s.id}`);
        // Collect user messages in reverse (newest first within session)
        const userMsgs = full.messages.filter(m => m.role === 'user' && typeof m.content === 'string');
        for (let i = userMsgs.length - 1; i >= 0; i--) {
          if (!allPrompts.includes(userMsgs[i].content)) {
            allPrompts.push(userMsgs[i].content);
          }
        }
      }
      // allPrompts is already newest-first (newest session first, newest msg first)
      setPromptHistory(prev => {
        // Merge: keep any current-session prompts at the front
        const merged = [...prev.filter(p => !allPrompts.includes(p)), ...allPrompts];
        // But actually prev (from sendMessage) should take priority
        const final = [...prev];
        for (const p of allPrompts) {
          if (!final.includes(p)) final.push(p);
        }
        return final.slice(0, 100);
      });
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
    sessionStorage.removeItem('brian-messages');
    sessionStorage.removeItem('brian-session-id');
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

  // Preview the first/last messages of a hovered/selected session
  const { data: previewData } = useQuery({
    queryKey: ['chat-session-preview', previewSessionId],
    queryFn: () => api.get<{ messages: Message[] }>(`/chat/sessions/${previewSessionId}`),
    enabled: !!previewSessionId,
    staleTime: 60_000,
  });

  async function bulkDelete() {
    if (selectedSessions.size === 0) return;
    if (!confirm(`Delete ${selectedSessions.size} chat${selectedSessions.size === 1 ? '' : 's'}?`)) return;
    const ids = [...selectedSessions];
    await Promise.all(ids.map(id => api.delete(`/chat/sessions/${id}`).catch(() => null)));
    if (ids.includes(sessionId!)) newSession();
    setSelectedSessions(new Set());
    setPreviewSessionId(null);
    refetchSessions();
  }

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
    setMessages(prev => prev.filter(m => m.content !== ':::thinking:::' && !m.content.startsWith(':::status:::')));
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text && pastedImages.length === 0) return;

    // If already streaming, stop it first
    if (streaming) stopStreaming();

    // Build content with images
    const images = pastedImages.map(img => img.data);
    const displayContent = text + (images.length > 0 ? `\n:::images:::${JSON.stringify(images)}` : '');
    const sendContent = text + (images.length > 0 ? '\n[Image attached]' : '');

    // Add to prompt history (most recent first, deduplicated)
    if (text) {
      setPromptHistory(prev => {
        const updated = [text, ...prev.filter(p => p !== text)];
        return updated.slice(0, 100);
      });
    }
    setPromptIdx(-1);

    const now = new Date().toISOString();
    const cleanMessages = messages.filter(m => m.content !== ':::thinking:::' && !m.content.startsWith(':::status:::'));
    const newMessages: Message[] = [...cleanMessages, { role: 'user', content: displayContent, timestamp: now }];
    setMessages([...newMessages, { role: 'assistant', content: ':::thinking:::', timestamp: now }]);
    setInput('');
    setPastedImages([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setStreaming(true);

    // Ensure session exists and save user message
    const sid = await ensureSession();
    await saveMessage(sid, 'user', text);

    let lastResponseText = '';

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      // Build messages, converting image markers to multimodal content
      const apiMessages = newMessages.map(m => {
        if (m.content.includes(':::images:::')) {
          const parts: any[] = [];
          const lines = m.content.split('\n');
          for (const line of lines) {
            if (line.startsWith(':::images:::')) {
              try {
                const imgs = JSON.parse(line.slice(12));
                for (const src of imgs) {
                  parts.push({ type: 'image_url', image_url: { url: src } });
                }
              } catch {}
            } else if (line.trim()) {
              parts.push({ type: 'text', text: line });
            }
          }
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
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
      const thinkingTrace: ThinkingStep[] = [];
      const sourcesList: SourceRef[] = [];
      const streamStart = Date.now();
      const stampThinking = () => thinkingTrace.map((s, idx) => ({
        ...s,
        durMs: idx < thinkingTrace.length - 1
          ? thinkingTrace[idx + 1].atMs - s.atMs
          : Date.now() - streamStart - s.atMs,
      }));

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
              if (parsed.status) {
                // Capture status into thinking trace + show as live indicator
                if (!thinkingTrace.find(t => t.text === parsed.status)) {
                  thinkingTrace.push({ text: parsed.status, atMs: Date.now() - streamStart });
                }
                setMessages(prev => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: 'assistant', content: `:::status:::${parsed.status}`, timestamp: new Date().toISOString() };
                  return copy;
                });
              }
              if (parsed.source) {
                sourcesList.push(parsed.source);
                setMessages(prev => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  copy[copy.length - 1] = {
                    ...last,
                    role: 'assistant',
                    sources: [...sourcesList],
                  };
                  return copy;
                });
              }
              if (parsed.content) {
                assistantMsg += parsed.content;
                setMessages(prev => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString(), thinking: thinkingTrace.length ? stampThinking() : undefined, sources: sourcesList.length ? [...sourcesList] : undefined };
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
                  copy[copy.length - 1] = { role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString(), thinking: thinkingTrace.length ? stampThinking() : undefined };
                  return copy;
                });
              }
            } catch { }
          }
        }
      }

      // Save assistant response
      if (assistantMsg) {
        lastResponseText = assistantMsg;
        await saveMessage(sid, 'assistant', assistantMsg);
        refetchSessions();
      }
    } catch (err: any) {
      try {
        const result = await api.post<{ reply: string }>('/chat', {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          model,
        });
        lastResponseText = result.reply;
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
    setMessages(prev => prev.filter(m => m.content !== ':::thinking:::' && !m.content.startsWith(':::status:::')));
    inputRef.current?.focus();

    // Notify if window is not visible
    if (lastResponseText) {
      try {
        const visible = await (window as any).brian?.isVisible?.().catch(() => true);
        if (visible === false) {
          (window as any).brian?.notify?.('Brian',
            lastResponseText.replace(/\*\*/g, '').replace(/\[.*?\]\(.*?\)/g, '').substring(0, 120)
          )?.catch?.(() => {});
        }
      } catch {}
    }
  };

  const BUILTIN_SLASH_COMMANDS = [
    { cmd: '/add task', placeholder: '/add task ', desc: 'Add a new task' },
    { cmd: '/add note', placeholder: '/add note ', desc: 'Add a new note' },
    { cmd: '/add reminder', placeholder: '/add reminder ', desc: 'Add a reminder' },
    { cmd: '/go tasks', placeholder: '/go tasks', desc: 'Open Tasks page' },
    { cmd: '/go emails', placeholder: '/go emails', desc: 'Open Emails page' },
    { cmd: '/go files', placeholder: '/go files', desc: 'Open Files page' },
    { cmd: '/go people', placeholder: '/go people', desc: 'Open People page' },
    { cmd: '/go day', placeholder: '/go day', desc: 'Open My Day' },
    { cmd: '/new chat', placeholder: '/new chat', desc: 'Start a new chat session' },
    { cmd: '/clear', placeholder: '/clear', desc: 'Clear current chat messages' },
    { cmd: '/scan files', placeholder: '/scan files', desc: 'Rescan open & recent files' },
  ];

  const SLASH_COMMANDS = [
    ...customPrompts.map(p => ({
      cmd: p.cmd,
      placeholder: p.prompt.includes('{args}') ? `${p.cmd} ` : p.cmd,
      desc: p.desc || 'Custom prompt',
      custom: true as const,
    })),
    ...BUILTIN_SLASH_COMMANDS,
  ];

  const slashMatch = input.match(/^(\/\S*)/);
  const slashFilter = slashMatch ? slashMatch[1].toLowerCase() : '';
  const slashVisible = input.startsWith('/') && !input.includes(' ');
  const slashFiltered = slashVisible
    ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(slashFilter))
    : [];

  const handleSlashCommand = (text: string): boolean => {
    const t = text.trim();

    // Custom user-defined prompts: expand the prompt template, set as input,
    // and send it as a normal chat message.
    const custom = findCustomPrompt(t, customPrompts);
    if (custom) {
      const expanded = expandPrompt(custom.prompt, custom.args);
      setInput('');
      sendMessage(expanded);
      return true;
    }

    const addTask = t.match(/^\/add\s+task\s+(.+)/i);
    if (addTask) {
      const title = addTask[1].trim();
      api.post('/notes', { title, notebookId: 1, isTask: true }).then(() => {
        qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); qc.invalidateQueries({ queryKey: ['notebooks'] });
      });
      setMessages(prev => [...prev, { role: 'assistant', content: `✓ Task added: **${title}**` }]);
      setInput(''); return true;
    }
    const addNote = t.match(/^\/add\s+note\s+(.+)/i);
    if (addNote) {
      const title = addNote[1].trim();
      api.post('/notes', { title, notebookId: 1, isTask: false }).then(() => {
        qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); qc.invalidateQueries({ queryKey: ['notebooks'] });
      });
      setMessages(prev => [...prev, { role: 'assistant', content: `✓ Note added: **${title}**` }]);
      setInput(''); return true;
    }
    const addReminder = t.match(/^\/add\s+reminder\s+(.+)/i);
    if (addReminder) {
      const title = addReminder[1].trim();
      const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      api.post('/reminders', { title, dueAt }).then(() => qc.invalidateQueries({ queryKey: ['reminders'] }));
      setMessages(prev => [...prev, { role: 'assistant', content: `✓ Reminder set: **${title}**` }]);
      setInput(''); return true;
    }
    if (/^\/go\s+tasks?$/i.test(t)) { navigate('/notes'); setInput(''); return true; }
    if (/^\/go\s+emails?$/i.test(t)) { navigate('/emails'); setInput(''); return true; }
    if (/^\/go\s+files?$/i.test(t)) { navigate('/files'); setInput(''); return true; }
    if (/^\/go\s+people$/i.test(t)) { navigate('/people'); setInput(''); return true; }
    if (/^\/go\s+day$/i.test(t)) { navigate('/'); setInput(''); return true; }
    if (/^\/new\s+chat$/i.test(t)) { newSession(); setInput(''); return true; }
    if (/^\/clear$/i.test(t)) { setMessages([]); setInput(''); return true; }
    if (/^\/scan\s+files$/i.test(t)) {
      api.post('/files/refresh').then(() => qc.invalidateQueries({ queryKey: ['files-open'] }));
      setMessages(prev => [...prev, { role: 'assistant', content: '✓ File scan started' }]);
      setInput(''); return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashFiltered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(i + 1, slashFiltered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        setInput(slashFiltered[slashIdx]?.placeholder ?? slashFiltered[0].placeholder);
        setSlashIdx(0);
        return;
      }
      if (e.key === 'Escape') { setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!handleSlashCommand(input)) sendMessage();
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

  const historyFiltered = historyFilter
    ? sessions.filter(s => s.title.toLowerCase().includes(historyFilter.toLowerCase()))
    : sessions;

  return (
    <div
      className="chat-panel"
      ref={panelRef}
      onWheel={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const next = clampZoom(zoom + dir * ZOOM_STEP);
        setZoom(next);
        flashZoom(next);
      }}
    >
      {zoomToast && <div className="chat-zoom-toast">{zoomToast}</div>}
      {/* History side panel */}
      <div className={`chat-history-panel ${showHistory ? 'open' : ''}`}>
        <div className="chat-history-header">
          <span style={{ fontWeight: 600, fontSize: 13 }}>Chat History</span>
          <button className="ghost" onClick={() => { setShowHistory(false); setHistoryFilter(''); setSelectedSessions(new Set()); setPreviewSessionId(null); }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: '6px 10px' }}>
          <input
            ref={historyInputRef}
            placeholder="Filter chats..."
            value={historyFilter}
            onChange={e => { setHistoryFilter(e.target.value); setHistoryIdx(-1); }}
            style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHistoryIdx(i => Math.min(i + 1, historyFiltered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHistoryIdx(i => Math.max(i - 1, -1));
              } else if (e.key === 'Enter' && historyIdx >= 0 && historyFiltered[historyIdx]) {
                e.preventDefault();
                loadSession(historyFiltered[historyIdx].id);
              } else if (e.key === 'Delete' && selectedSessions.size > 0) {
                e.preventDefault();
                bulkDelete();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowHistory(false);
                setHistoryFilter('');
                setHistoryIdx(-1);
                setSelectedSessions(new Set());
                setPreviewSessionId(null);
              }
            }}
          />
        </div>
        {selectedSessions.size > 0 && (
          <div className="chat-history-bulkbar">
            <span>{selectedSessions.size} selected</span>
            <div style={{ flex: 1 }} />
            <button className="ghost" onClick={() => setSelectedSessions(new Set())}>Clear</button>
            <button className="danger-link" onClick={bulkDelete}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
        <div className="chat-history-list">
          {historyFiltered.map((s, i) => {
            const isSelected = selectedSessions.has(s.id);
            const isPreview = previewSessionId === s.id;
            return (
            <div
              key={s.id}
              className={`chat-history-item ${sessionId === s.id ? 'active' : ''} ${historyIdx === i ? 'highlighted' : ''} ${isSelected ? 'multi-selected' : ''} ${isPreview ? 'previewing' : ''}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  setSelectedSessions(prev => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                    return next;
                  });
                } else if (e.shiftKey && selectedSessions.size > 0) {
                  // range select from last selected to this one
                  const ids = historyFiltered.map(x => x.id);
                  const lastIdx = ids.findIndex(id => selectedSessions.has(id));
                  const [from, to] = [Math.min(lastIdx, i), Math.max(lastIdx, i)];
                  setSelectedSessions(new Set(ids.slice(from, to + 1)));
                } else {
                  setPreviewSessionId(s.id);
                  setSelectedSessions(new Set());
                }
              }}
              onDoubleClick={() => loadSession(s.id)}
            >
              <input
                type="checkbox"
                className="chat-history-check"
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setSelectedSessions(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s.id); else next.delete(s.id);
                    return next;
                  });
                }}
              />
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 12, fontWeight: 500 }}>{s.title}</div>
                <div className="text-xs text-muted">{new Date(s.updatedAt).toLocaleString()}</div>
              </div>
              <button className="ghost" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(s.id); }} title="Delete this chat">
                <Trash2 size={12} />
              </button>
            </div>
            );
          })}
          {historyFiltered.length === 0 && (
            <div className="empty-inline">
              {historyFilter ? 'No matches' : 'No chat history yet'}
            </div>
          )}
        </div>
      </div>
      {showHistory && previewSessionId && (
        <div className="chat-history-preview">
          <div className="chat-history-preview-header">
            <span>Preview</span>
            <button className="ghost" onClick={() => loadSession(previewSessionId)} title="Open this chat">Open →</button>
          </div>
          <div className="chat-history-preview-body">
            {!previewData && <div className="text-xs text-muted">Loading…</div>}
            {previewData && previewData.messages.slice(0, 6).map((m, i) => (
              <div key={i} className={`chat-history-preview-msg ${m.role}`}>
                <div className="chat-history-preview-role">{m.role}</div>
                <div className="chat-history-preview-content">{(m.content || '').slice(0, 200)}{(m.content || '').length > 200 ? '…' : ''}</div>
              </div>
            ))}
            {previewData && previewData.messages.length === 0 && (
              <div className="text-xs text-muted">Empty chat</div>
            )}
          </div>
        </div>
      )}

      {/* Mini toolbar */}
      <div className="chat-toolbar">
        <button className="ghost" onClick={() => window.dispatchEvent(new CustomEvent('brian-open-drawer'))} title="Menu">
          <Menu size={14} />
        </button>
        <button className="ghost" onClick={() => setShowHistory(true)} title="Chat history (Ctrl+H)">
          <History size={14} />
        </button>
        <button className="ghost" onClick={newSession} title="New chat (Ctrl+N)">
          <Plus size={14} />
        </button>
        {onChatFullscreen && (
          <button className="ghost" onClick={onChatFullscreen} title="Fullscreen chat">
            <Maximize2 size={14} />
          </button>
        )}
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
            <BrianMascot size={90} />
            <h2>Hi, I'm Brian</h2>
            <p>Your second brain. Manage tasks, notes, reminders, search emails, or just chat.</p>
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
              {suggestions.map(s => (
                <button key={s} className="chat-suggestion" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Thinking indicator
          if (msg.content === ':::thinking:::' || msg.content.startsWith(':::status:::')) {
            const statusText = msg.content.startsWith(':::status:::') ? msg.content.slice(12) : 'Thinking...';
            return (
              <div key={i} className="chat-bubble assistant">
                <div className="chat-avatar">
                  <BrianMascot size={24} />
                </div>
                <div className="chat-thinking">
                  <div className="thinking-dots">
                    <span /><span /><span />
                  </div>
                  <span className="thinking-label">{statusText}</span>
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={`chat-bubble ${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="chat-avatar">
                  <BrianMascot size={24} />
                </div>
              )}
              <div className="chat-bubble-wrap">
                <div className="chat-bubble-content">
                  {msg.content.split('\n').map((line, j) => {
                    if (line.startsWith(':::images:::')) {
                      try {
                        const imgs = JSON.parse(line.slice(12));
                        return <div key={j} className="chat-images">{imgs.map((src: string, k: number) => (
                          <img key={k} src={src} alt="Pasted" className="chat-pasted-image" onClick={() => setLightboxSrc(src)} />
                        ))}</div>;
                      } catch { return null; }
                    }
                    // Headings
                    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
                    if (headingMatch) {
                      const level = headingMatch[1].length;
                      const Tag = `h${Math.min(level + 1, 6)}` as any;
                      return <Tag key={j} className="chat-heading">{renderMarkdownLine(headingMatch[2])}</Tag>;
                    }
                    // Bullet list items
                    if (line.match(/^\s*[-*]\s+/)) {
                      const text = line.replace(/^\s*[-*]\s+/, '');
                      return <div key={j} className="chat-list-item">{renderMarkdownLine(text)}</div>;
                    }
                    // Numbered list items
                    if (line.match(/^\s*\d+[.)]\s+/)) {
                      const text = line.replace(/^\s*\d+[.)]\s+/, '');
                      const num = line.match(/^\s*(\d+)/)?.[1];
                      return <div key={j} className="chat-list-item numbered"><span className="chat-list-num">{num}.</span>{renderMarkdownLine(text)}</div>;
                    }
                    return <p key={j}>{renderMarkdownLine(line)}</p>;
                  })}
                  {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                    <span className="chat-cursor" />
                  )}
                  {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                    <div className="chat-sources">
                      {msg.sources.map((src, sIdx) => {
                        const key = `${i}:${sIdx}`;
                        const isOpen = openSource === key;
                        return (
                          <div key={sIdx} className={`chat-source-card ${isOpen ? 'open' : ''}`}>
                            <button
                              className="chat-source-chip"
                              onClick={() => setOpenSource(isOpen ? null : key)}
                              title="Click for details"
                            >
                              <Database size={11} />
                              <span>{src.label}</span>
                              {typeof src.count === 'number' && (
                                <span className="chat-source-count">{src.count}</span>
                              )}
                            </button>
                            {isOpen && (
                              <div className="chat-source-details">
                                {src.query && (
                                  <div className="chat-source-meta">
                                    <span className="chat-source-meta-label">Query:</span>
                                    <code>{src.query}</code>
                                  </div>
                                )}
                                {src.items && src.items.length > 0 && (
                                  <ul className="chat-source-items">
                                    {src.items.map((it: any, k: number) => (
                                      <li key={k}>
                                        {Object.entries(it)
                                          .filter(([, v]) => v != null && v !== '')
                                          .map(([key2, value]) => (
                                            <div key={key2} className="chat-source-field">
                                              <span className="chat-source-field-key">{key2}:</span>
                                              <span className="chat-source-field-val">{String(value)}</span>
                                            </div>
                                          ))}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {msg.role === 'assistant' && msg.thinking && msg.thinking.length > 0 && (
                    <div className="chat-thinking-section">
                      <button
                        className="chat-thinking-toggle"
                        onClick={() => setOpenThinking(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        })}
                      >
                        <Brain size={12} />
                        {openThinking.has(i)
                          ? `Hide thinking (${msg.thinking.length})`
                          : `Show thinking (${msg.thinking.length})`}
                      </button>
                      {openThinking.has(i) && (
                        <ol className="chat-thinking-list">
                          {msg.thinking.map((step, k) => {
                            const sec = step.durMs != null ? (step.durMs / 1000).toFixed(step.durMs < 1000 ? 2 : 1) : null;
                            return (
                              <li key={k}>
                                <span>{step.text}</span>
                                {sec && <span className="chat-thinking-time">{sec}s</span>}
                              </li>
                            );
                          })}
                          {msg.thinking.length > 0 && (
                            <li className="chat-thinking-total">
                              <span>Total</span>
                              <span className="chat-thinking-time">
                                {(msg.thinking.reduce((a, s) => a + (s.durMs || 0), 0) / 1000).toFixed(1)}s
                              </span>
                            </li>
                          )}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
                <button className="chat-copy-btn" title="Copy" onClick={() => {
                  navigator.clipboard.writeText(msg.content);
                }}>
                  <Copy size={12} />
                </button>
                {msg.timestamp && (
                  <div className={`chat-timestamp ${msg.role}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {pastedImages.length > 0 && (
        <div className="chat-image-previews">
          {pastedImages.map((img, i) => (
            <div key={i} className="chat-image-preview">
              <img src={img.data} alt={img.name} />
              <button className="ghost" onClick={() => setPastedImages(prev => prev.filter((_, j) => j !== i))}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {slashFiltered.length > 0 && (
        <div className="slash-popup">
          {slashFiltered.map((c, i) => (
            <div
              key={c.cmd}
              className={`slash-item ${i === slashIdx ? 'active' : ''}`}
              onMouseEnter={() => setSlashIdx(i)}
              onMouseDown={e => { e.preventDefault(); setInput(c.placeholder); inputRef.current?.focus(); }}
            >
              <span className="slash-item-cmd">{c.cmd}</span>
              <span className="slash-item-desc">
                {(c as any).custom && <span className="slash-item-badge">custom</span>}
                {c.desc}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-bar">
        <button
          className={`chat-mic ${voiceActive ? 'active' : ''}`}
          onClick={voiceActive ? stopVoice : startVoice}
          title={voiceActive ? 'Stop recording' : 'Voice input'}
        >
          <Mic size={15} />
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => {
            setInput(e.target.value); setPromptIdx(-1); setSlashIdx(0);
            // Auto-resize
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 150) + 'px';
          }}
          onKeyDown={handleKeyDown}
          onPaste={e => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) continue;
                // Compress image to avoid payload-too-large errors
                const reader = new FileReader();
                reader.onload = () => {
                  const img = new Image();
                  img.onload = () => {
                    const maxDim = 1200;
                    let w = img.width, h = img.height;
                    if (w > maxDim || h > maxDim) {
                      const scale = maxDim / Math.max(w, h);
                      w = Math.round(w * scale);
                      h = Math.round(h * scale);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
                    const data = canvas.toDataURL('image/jpeg', 0.7);
                    setPastedImages(prev => [...prev, { data, name: file.name || 'image.png' }]);
                  };
                  img.src = reader.result as string;
                };
                reader.readAsDataURL(file);
              }
            }
          }}
          placeholder={authenticated ? 'Ask me anything... (↑ for history)' : 'Sign in with GitHub to chat'}
          disabled={!authenticated && !authPending}
          rows={1}
        />
        {streaming ? (
          <button onClick={stopStreaming} className="chat-send chat-stop" title="Stop">
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || !authenticated}
            className="chat-send"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      {lightboxSrc && (
        <div className="chat-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="Full size" onClick={e => e.stopPropagation()} />
          <button className="chat-lightbox-close" onClick={() => setLightboxSrc(null)}>&times;</button>
        </div>
      )}
    </div>
  );
}

function renderMarkdownLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/);
    const codeMatch = remaining.match(/`(.+?)`/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const urlMatch = remaining.match(/(?<!\()(https?:\/\/[^\s<>"')\]]+)/);

    const matches = [boldMatch, italicMatch, codeMatch, linkMatch, urlMatch].filter(Boolean).sort((a, b) => a!.index! - b!.index!);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const match = matches[0]!;
    const idx = match.index!;

    if (idx > 0) parts.push(remaining.substring(0, idx));

    if (match[0].startsWith('**')) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[0].startsWith('*')) {
      parts.push(<em key={key++}>{match[1]}</em>);
    } else if (match[0].startsWith('`')) {
      parts.push(<code key={key++} className="inline-code">{match[1]}</code>);
    } else if (match[0].startsWith('[')) {
      parts.push(<a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer" className="chat-link">{match[1]}</a>);
    } else if (match[0].startsWith('http')) {
      const display = match[0].length > 50 ? match[0].substring(0, 47) + '...' : match[0];
      parts.push(<a key={key++} href={match[0]} target="_blank" rel="noopener noreferrer" className="chat-link">{display}</a>);
    }

    remaining = remaining.substring(idx + match[0].length);
  }

  return parts.length > 0 ? parts : line || '\u00A0';
}
