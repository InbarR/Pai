import { ReactNode, useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  MessageCircle, Sparkles, CheckSquare, Bell, BookOpen, Mail, FolderOpen, Users,
  PanelLeftOpen, PanelLeftClose, Maximize2, Minimize2, Settings,
} from 'lucide-react';
import ChatPanel from './chat/ChatPanel';

const SIDECAR_THRESHOLD = 600; // px — below this = sidecar mode

export default function Layout({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [width, setWidth] = useState(window.innerWidth);
  const location = useLocation();

  const isSidecar = width < SIDECAR_THRESHOLD;

  // Track window resizes
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const goSidecar = useCallback(() => {
    try { (window as any).pai?.sidecar?.('right'); } catch {}
    // Width change will trigger re-render automatically
  }, []);

  const goFull = useCallback(() => {
    try { (window as any).pai?.maximize?.(); } catch {}
    // Width change will trigger re-render automatically
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && e.key === 'f') {
        e.preventDefault();
        if (window.innerWidth < SIDECAR_THRESHOLD) {
          try { (window as any).pai?.maximize?.(); } catch {}
        } else {
          try { (window as any).pai?.sidecar?.('right'); } catch {}
        }
      }
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName || '')) {
        if (window.innerWidth >= SIDECAR_THRESHOLD) {
          try { (window as any).pai?.sidecar?.('right'); } catch {}
        } else {
          try { (window as any).pai?.hide?.(); } catch {}
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Force sidecar from Electron (Ctrl+2)
  useEffect(() => {
    const handler = () => {
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
      return {
        notes: notes.length,
        emails: emails.length,
        reminders: d.activeReminderCount,
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
    { to: '/reminders', label: 'Reminders', icon: Bell, count: counts?.reminders || 0 },
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
            <button className="ghost expand-btn" onClick={goFull} title="Expand (Alt+F)">
              <Maximize2 size={14} />
              <kbd>Alt+F</kbd>
            </button>
          </div>
          <ChatPanel />
        </div>
        <div className="chat-mode-nav">
          {navItems.map(({ to, label, icon: Icon, count }) => (
            <NavLink key={to} to={to} end={to === '/'} title={label}
              className={({ isActive }) => `chat-nav-item ${isActive && to !== '/' ? 'active' : ''}`}
              onClick={goFull}>
              <Icon size={16} />
              {count > 0 && <span className="chat-nav-count">{count}</span>}
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
        <nav>
          {navItems.map(({ to, label, icon: Icon, count }) => (
            <NavLink key={to} to={to} end={to === '/'} title={label}
              className={({ isActive }) => isActive ? 'active' : ''}>
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
          <button className="sidebar-pin" onClick={goSidecar} title="Sidecar mode (Alt+F)">
            <Minimize2 size={16} />
          </button>
          <button className="sidebar-pin" onClick={() => { try { (window as any).pai?.hide?.(); } catch {} }} title="Minimize to tray">
            <span style={{ fontSize: 16, lineHeight: 1 }}>—</span>
          </button>
          <button className="sidebar-pin" onClick={() => setPinned(!pinned)}
            title={pinned ? 'Collapse' : 'Pin sidebar'}>
            {pinned ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
      </aside>

      <main className="content">{children}</main>

      {!chatOpen && (
        <button className="chat-edge-toggle" onClick={() => setChatOpen(true)} title="Open chat">
          <MessageCircle size={18} />
        </button>
      )}

      <div className={`chat-sidebar ${chatOpen ? 'open' : ''}`}>
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
