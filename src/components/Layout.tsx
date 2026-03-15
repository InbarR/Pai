import { ReactNode, useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  MessageCircle, Sparkles, StickyNote, Bell, BookOpen, Mail, FolderOpen, Users,
  PanelLeftOpen, PanelLeftClose, Maximize2, Minimize2, Settings,
} from 'lucide-react';
import ChatPanel from './chat/ChatPanel';

export default function Layout({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [isSidecar, setIsSidecar] = useState(true); // true = narrow chat-only, false = full app
  const location = useLocation();

  const pai = (window as any).pai;

  const goSidecar = () => {
    setIsSidecar(true);
    if (pai?.sidecar) pai.sidecar('right');
  };

  const goFull = () => {
    setIsSidecar(false);
    if (pai?.maximize) pai.maximize();
  };

  const toggle = () => {
    if (isSidecar) goFull(); else goSidecar();
  };

  // Events from App.tsx
  useEffect(() => {
    const onShowChat = () => goSidecar();
    const onToggle = () => toggle();
    const onEsc = () => {
      if (!isSidecar) goSidecar();
      else if (pai?.hide) pai.hide();
    };
    window.addEventListener('pai-show-chat', onShowChat);
    window.addEventListener('pai-toggle-size', onToggle);
    window.addEventListener('pai-esc', onEsc);
    return () => {
      window.removeEventListener('pai-show-chat', onShowChat);
      window.removeEventListener('pai-toggle-size', onToggle);
      window.removeEventListener('pai-esc', onEsc);
    };
  }, [isSidecar]);

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
    { to: '/notes', label: 'Notes', icon: StickyNote, count: counts?.notes || 0 },
    { to: '/files', label: 'Files', icon: FolderOpen, count: 0 },
    { to: '/people', label: 'People', icon: Users, count: 0 },
    { to: '/emails', label: 'Emails', icon: Mail, count: counts?.emails || 0 },
    { to: '/reminders', label: 'Reminders', icon: Bell, count: counts?.reminders || 0 },
    { to: '/reading', label: 'Reading', icon: BookOpen, count: counts?.reading || 0 },
  ];

  // === SIDECAR MODE: chat only ===
  if (isSidecar) {
    return (
      <div className="app-layout chat-mode">
        <div className="chat-mode-main">
          <div className="chat-mode-topbar">
            <div className="flex items-center gap-2">
              <div className="brand-dot" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Pai</span>
            </div>
            <button className="ghost" onClick={goFull} title="Expand (Alt+F)">
              <Maximize2 size={14} />
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

  // === FULL MODE: sidebar + content + chat panel ===
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
          <button className="sidebar-pin" onClick={goSidecar} title="Sidecar mode (Esc)">
            <Minimize2 size={16} />
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
