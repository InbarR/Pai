import { ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  MessageCircle, Sparkles, CheckSquare, Bell, Mail, FolderOpen, Users,
  PanelLeftClose, PanelRightClose, Settings, Menu, X,
} from 'lucide-react';
import ChatPanel from './chat/ChatPanel';

export default function Layout({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(380);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const resizingRef = useRef(false);
  const isElectron = !!(window as any).brian?.isElectron;
  const [mode, setMode] = useState<'sidecar' | 'wide' | 'full'>(isElectron ? 'sidecar' : 'full');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [altHeld, setAltHeld] = useState(false);
  const chatMaximizedRef = useRef(false);
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
    try { (window as any).brian?.sidecar?.('right'); } catch {}
  }, []);

  const goWide = useCallback(() => {
    setMode('wide');
    try { (window as any).brian?.sidecar?.('right-wide'); } catch {}
  }, []);

  const goFull = useCallback(() => {
    setMode('full');
    try { (window as any).brian?.maximize?.(); } catch {}
  }, []);

  // Toggle: sidecar ↔ full
  const cycleMode = useCallback(() => {
    if (modeRef.current === 'sidecar' || modeRef.current === 'wide') goFull();
    else goSidecar();
  }, [goFull, goSidecar]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Alt+F — toggle sidecar ↔ full
      if (e.altKey && e.key === 'f') {
        e.preventDefault();
        cycleMode();
      }
      // Esc — sidecar→hide only (full mode stays)
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName || '')) {
        if (modeRef.current !== 'full') try { (window as any).brian?.hide?.(); } catch {}
      }
      // Alt+1..6 — navigate to sections (goes to full mode)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const routes = ['/', '/notes', '/files', '/people', '/emails'];
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
      try { (window as any).brian?.sidecar?.('right'); } catch {}
    };
    window.addEventListener('brian-force-sidecar', handler);
    window.addEventListener('brian-show-chat', handler);
    return () => {
      window.removeEventListener('brian-force-sidecar', handler);
      window.removeEventListener('brian-show-chat', handler);
    };
  }, []);

  // Open companion drawer from chat toolbar
  useEffect(() => {
    const handler = () => setDrawerOpen(true);
    window.addEventListener('brian-open-drawer', handler);
    return () => window.removeEventListener('brian-open-drawer', handler);
  }, []);

  const { data: counts } = useQuery({
    queryKey: ['nav-counts'],
    queryFn: async () => {
      const d = await api.get<any>('/dashboard');
      const emails = await api.get<any[]>('/emails');
      const notes = await api.get<any[]>('/notes');
      const openTasks = notes.filter((n: any) => !(n.isTask && n.taskStatus === 2)).length;
      return {
        notes: openTasks + (d.activeReminderCount || 0),
        emails: emails.length,
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
  ];

  // === COMPANION MODE: chat only (narrow window) with slide-out sidebar ===
  if (isSidecar) {
    return (
      <div className="app-layout chat-mode">
        <div className="chat-mode-main">
          <div className="chat-mode-topbar">
            <div className="flex items-center gap-2">
              <div className="brand-dot" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Brian</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>Companion</span>
            </div>
            <div className="win-controls">
              <button className="win-btn" onClick={() => { try { (window as any).brian?.minimize?.(); } catch {} }} title="Minimize">&#x2013;</button>
              <button className="win-btn" onClick={goFull} title="Expand to full layout">&#x25A1;</button>
              <button className="win-btn close" onClick={() => { try { (window as any).brian?.hide?.(); } catch {} }} title="Close to tray">&#x2715;</button>
            </div>
          </div>
          <ChatPanel onChatFullscreen={() => {
            try {
              if (chatMaximizedRef.current) {
                (window as any).brian?.sidecar?.('right');
                chatMaximizedRef.current = false;
              } else {
                (window as any).brian?.maximize?.();
                chatMaximizedRef.current = true;
              }
            } catch {}
          }} />
        </div>

        {drawerOpen && (
          <>
            <div className="companion-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
            <aside className="sidebar companion-drawer">
              <div className="companion-drawer-header">
                <div className="flex items-center gap-2">
                  <div className="brand-dot" />
                  <h1 className="companion-drawer-title">Brian</h1>
                </div>
                <button className="drawer-close-btn" onClick={() => setDrawerOpen(false)} title="Close menu">
                  <X size={18} />
                </button>
              </div>

              <div className="sidebar-top-actions">
                <button
                  className="sidebar-action primary"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('brian-new-chat'));
                    setDrawerOpen(false);
                  }}
                  title="New chat"
                >
                  <MessageCircle size={16} />
                  <span>New chat</span>
                </button>
              </div>

              <div className="sidebar-section-label">Workspace</div>
              <nav className="sidebar-nav">
                {navItems.map(({ to, label, icon: Icon, count }, idx) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    title={`${label} (Alt+${idx + 1})`}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => setDrawerOpen(false)}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                    {count > 0 && <span className="nav-count">{count}</span>}
                  </NavLink>
                ))}
              </nav>

              <div className="sidebar-footer">
                <NavLink
                  to="/settings"
                  className={({ isActive }) => `sidebar-user ${isActive ? 'active' : ''}`}
                  title="Settings"
                  style={{ textDecoration: 'none' }}
                  onClick={() => setDrawerOpen(false)}
                >
                  <div className="sidebar-user-avatar">
                    <Settings size={14} />
                  </div>
                  <span>Settings</span>
                </NavLink>
              </div>
            </aside>
          </>
        )}
      </div>
    );
  }

  // === FULL MODE: sidebar + content + chat panel (wide window) ===
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={goSidecar} style={{ cursor: 'pointer' }} title="Switch to Companion mode (Esc)">
          <div className="brand-dot" />
          <h1>Brian</h1>
        </div>

        <div className="sidebar-top-actions">
          <button
            className="sidebar-action primary"
            onClick={() => {
              navigate('/');
              window.dispatchEvent(new CustomEvent('brian-new-chat'));
              if (!chatOpen) setChatOpen(true);
            }}
            title="New chat"
          >
            <MessageCircle size={16} />
            <span>New chat</span>
          </button>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav className={`sidebar-nav ${altHeld ? 'alt-held' : ''}`}>
          {navItems.map(({ to, label, icon: Icon, count }, idx) => (
            <NavLink key={to} to={to} end={to === '/'} title={`${label} (Alt+${idx + 1})`}
              data-tooltip={label}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={16} />
              <span>{label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
              <span className="nav-shortcut">{idx + 1}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `sidebar-user ${isActive ? 'active' : ''}`}
            title="Settings" style={{ textDecoration: 'none' }}>
            <div className="sidebar-user-avatar">
              <Settings size={14} />
            </div>
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      <main className="content" style={chatOpen ? { marginRight: chatWidth } : undefined}>
        <div className="page-transition" key={location.pathname}>{children}</div>
      </main>

      {!chatOpen && (
        <button className="chat-edge-toggle" onClick={() => setChatOpen(true)} title="Open chat">
          <MessageCircle size={18} />
        </button>
      )}
      {!chatOpen && (
        <div className="win-controls-fixed">
          <button className="win-btn" onClick={() => { try { (window as any).brian?.minimize?.(); } catch {} }} title="Minimize">&#x2013;</button>
          <button className="win-btn close" onClick={() => { try { (window as any).brian?.hide?.(); } catch {} }} title="Close to tray">&#x2715;</button>
        </div>
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
            <span style={{ fontWeight: 600, fontSize: 14 }}>Brian</span>
          </div>
          <div className="win-controls">
            <button className="win-btn" onClick={() => { try { (window as any).brian?.minimize?.(); } catch {} }} title="Minimize">&#x2013;</button>
            <button className="win-btn" onClick={goSidecar} title="Companion mode (Alt+F)">&#x25A1;</button>
            <button className="win-btn close" onClick={() => { try { (window as any).brian?.hide?.(); } catch {} }} title="Close to tray">&#x2715;</button>
          </div>
        </div>
        {chatOpen && <ChatPanel onChatFullscreen={() => { goSidecar(); setTimeout(() => { try { (window as any).brian?.maximize?.(); } catch {} }, 100); }} />}
      </div>
    </div>
  );
}
