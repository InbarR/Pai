import { ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  MessageCircle, Sparkles, CheckSquare, Bell, BookOpen, Mail, FolderOpen, Users,
  PanelLeftOpen, PanelLeftClose, Maximize2, Minimize2, Settings,
} from 'lucide-react';
import ChatPanel from './chat/ChatPanel';

// Mode is now explicit state, not based on window width

export default function Layout({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(380);
  const resizingRef = useRef(false);
  const [mode, setMode] = useState<'sidecar' | 'wide' | 'full'>('sidecar');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [altHeld, setAltHeld] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Track Alt key hold
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => setAltHeld(false));
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const isSidecar = mode === 'sidecar' || mode === 'wide';

  const goSidecar = useCallback(() => {
    setMode('sidecar');
    try { (window as any).pai?.sidecar?.('right'); } catch {}
  }, []);

  const goWide = useCallback(() => {
    setMode('wide');
    try { (window as any).pai?.sidecar?.('right-wide'); } catch {}
  }, []);

  const goFull = useCallback(() => {
    setMode('full');
    try { (window as any).pai?.maximize?.(); } catch {}
  }, []);

  // Cycle: sidecar → wide → full → sidecar
  const cycleMode = useCallback(() => {
    if (modeRef.current === 'sidecar') goWide();
    else if (modeRef.current === 'wide') goFull();
    else goSidecar();
  }, [goWide, goFull, goSidecar]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Alt+F — cycle: sidecar → wide → full → sidecar
      if (e.altKey && e.key === 'f') {
        e.preventDefault();
        cycleMode();
      }
      // Esc — full→wide→sidecar→hide
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName || '')) {
        if (modeRef.current === 'full') goWide();
        else if (modeRef.current === 'wide') goSidecar();
        else try { (window as any).pai?.hide?.(); } catch {}
      }
      // Alt+1..6 — navigate to sections (goes to full mode)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const routes = ['/', '/notes', '/files', '/people', '/emails', '/reading'];
        const num = parseInt(e.key);
        if (num >= 1 && num <= routes.length) {
          e.preventDefault();
          navigate(routes[num - 1]);
          if (modeRef.current === 'sidecar') goFull();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Force sidecar from Electron (Ctrl+2)
  useEffect(() => {
    const handler = () => {
      setMode('sidecar');
      try { (window as any).pai?.sidecar?.('right'); } catch {}
    };
    window.addEventListener('pai-force-sidecar', handler);
    window.addEventListener('pai-show-chat', handler);
    return () => {
      window.removeEventListener('pai-force-sidecar', handler);
      window.removeEventListener('pai-show-chat', handler);
    };
  }, []);

  const { data: counts } = useQuery({
    queryKey: ['nav-counts'],
    queryFn: async () => {
      const d = await api.get<any>('/dashboard');
      const emails = await api.get<any[]>('/emails');
      const reading = await api.get<any[]>('/reading?unreadOnly=true');
      const notes = await api.get<any[]>('/notes');
      const openTasks = notes.filter((n: any) => !(n.isTask && n.taskStatus === 2)).length;
      return {
        notes: openTasks + (d.activeReminderCount || 0),
        emails: emails.length,
        reading: reading.length,
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const navItems = [
    { to: '/', label: 'My Day', icon: Sparkles, count: 0 },
    { to: '/notes', label: 'Tasks', icon: CheckSquare, count: counts?.notes || 0 },
    { to: '/files', label: 'Files', icon: FolderOpen, count: 0 },
    { to: '/people', label: 'People', icon: Users, count: 0 },
    { to: '/emails', label: 'Emails', icon: Mail, count: counts?.emails || 0 },
    { to: '/reading', label: 'Reading', icon: BookOpen, count: counts?.reading || 0 },
  ];

  // === SIDECAR MODE: chat only (narrow window) ===
  if (isSidecar) {
    return (
      <div className="app-layout chat-mode">
        <div className="chat-mode-main">
          <div className="chat-mode-topbar">
            <div className="flex items-center gap-2">
              <div className="brand-dot" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Pai</span>
            </div>
            <div className="mode-switcher">
              <button className={`mode-btn ${mode === 'sidecar' ? 'active' : ''}`} onClick={goSidecar} title="Sidecar">
                <span className="mode-icon"><span className="mode-fill" style={{ width: '35%', left: 'auto', right: 0 }} /></span>
              </button>
              <button className={`mode-btn ${mode === 'wide' ? 'active' : ''}`} onClick={goWide} title="Wide chat">
                <span className="mode-icon"><span className="mode-fill" style={{ width: '60%', left: 'auto', right: 0 }} /></span>
              </button>
              <button className={`mode-btn ${mode === 'full' ? 'active' : ''}`} onClick={goFull} title="Full app">
                <span className="mode-icon"><span className="mode-fill" style={{ width: '100%' }} /></span>
              </button>
              <button className="mode-btn" onClick={() => { try { (window as any).pai?.hide?.(); } catch {} }} title="Hide (Esc)">—</button>
            </div>
          </div>
          <ChatPanel />
        </div>
        <div className={`chat-mode-nav ${altHeld ? 'alt-held' : ''}`}>
          {navItems.map(({ to, label, icon: Icon, count }, idx) => (
            <NavLink key={to} to={to} end={to === '/'} title={`${label} (Alt+${idx + 1})`}
              className={({ isActive }) => `chat-nav-item ${isActive && to !== '/' ? 'active' : ''}`}
              onClick={goFull}>
              <Icon size={16} />
              {count > 0 && <span className="chat-nav-count">{count}</span>}
              <span className="chat-nav-hint">({idx + 1})</span>
            </NavLink>
          ))}
          <NavLink to="/settings" className={({ isActive }) => `chat-nav-item ${isActive ? 'active' : ''}`}
            title="Settings" onClick={goFull}>
            <Settings size={16} />
          </NavLink>
        </div>
      </div>
    );
  }

  // === FULL MODE: sidebar + content + chat panel (wide window) ===
  return (
    <div className="app-layout">
      <aside className={`sidebar ${pinned ? 'pinned' : ''}`}>
        <div className="sidebar-brand" onClick={goSidecar} style={{ cursor: 'pointer' }} title="Sidecar (Esc)">
          <div className="brand-dot" />
          <h1>Pai</h1>
        </div>
        <nav className={altHeld ? 'alt-held' : ''}>
          {navItems.map(({ to, label, icon: Icon, count }, idx) => (
            <NavLink key={to} to={to} end={to === '/'} title={`${label} (Alt+${idx + 1})`}
              className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-shortcut">[{idx + 1}]</span>
              <Icon size={18} />
              <span>{label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavLink to="/settings" className={({ isActive }) => `sidebar-pin ${isActive ? 'active' : ''}`}
            title="Settings" style={{ textDecoration: 'none' }}>
            <Settings size={16} />
          </NavLink>
          <button className={`sidebar-pin ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen(!chatOpen)} title={chatOpen ? 'Close chat' : 'Open chat'}>
            <MessageCircle size={16} />
          </button>
          <div className="mode-switcher" style={{ padding: '4px 0' }}>
            <button className={`mode-btn ${mode === 'sidecar' ? 'active' : ''}`} onClick={goSidecar} title="Sidecar">S</button>
            <button className={`mode-btn ${mode === 'wide' ? 'active' : ''}`} onClick={goWide} title="Wide chat">W</button>
            <button className={`mode-btn ${mode === 'full' ? 'active' : ''}`} onClick={goFull} title="Full app">F</button>
            <button className="mode-btn" onClick={() => { try { (window as any).pai?.hide?.(); } catch {} }} title="Hide">—</button>
          </div>
        </div>
      </aside>

      <main className="content" style={chatOpen ? { marginRight: chatWidth } : undefined}>{children}</main>

      {!chatOpen && (
        <button className="chat-edge-toggle" onClick={() => setChatOpen(true)} title="Open chat">
          <MessageCircle size={18} />
        </button>
      )}

      {chatOpen && (
        <div className="resize-handle" style={{ right: chatWidth - 2 }} onMouseDown={e => {
          e.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          const onMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            const newWidth = Math.max(280, Math.min(700, window.innerWidth - ev.clientX));
            setChatWidth(newWidth);
          };
          const onUp = () => {
            resizingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }} />
      )}

      <div className={`chat-sidebar ${chatOpen ? 'open' : ''}`} style={chatOpen ? { width: chatWidth } : undefined}>
        <div className="chat-sidebar-header">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Pai</span>
          </div>
          <button className="ghost" onClick={() => setChatOpen(false)} title="Close chat">
            <PanelLeftClose size={16} />
          </button>
        </div>
        {chatOpen && <ChatPanel />}
      </div>
    </div>
  );
}
