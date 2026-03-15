import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  Sparkles, CheckSquare, FolderOpen, Users, Mail, Bell, BookOpen, Settings,
  MessageCircle, Plus, Search, Minimize2, Maximize2, Moon,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  icon: any;
  category: 'nav' | 'action' | 'window';
  shortcut?: string;
  action: () => void;
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [subPrompt, setSubPrompt] = useState<{ label: string; placeholder: string; onSubmit: (val: string) => void } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const go = useCallback((path: string) => {
    navigate(path);
    // If in sidecar, expand to full
    if (window.innerWidth < 600) {
      try { (window as any).pai?.maximize?.(); } catch {}
    }
    onClose();
  }, [navigate, onClose]);

  const commands: Command[] = [
    // Navigation
    { id: 'nav-day', label: 'Go to My Day', icon: Sparkles, category: 'nav', action: () => go('/') },
    { id: 'nav-tasks', label: 'Go to Tasks', icon: CheckSquare, category: 'nav', action: () => go('/notes') },
    { id: 'nav-files', label: 'Go to Files', icon: FolderOpen, category: 'nav', action: () => go('/files') },
    { id: 'nav-people', label: 'Go to People', icon: Users, category: 'nav', action: () => go('/people') },
    { id: 'nav-emails', label: 'Go to Emails', icon: Mail, category: 'nav', action: () => go('/emails') },
    { id: 'nav-reminders', label: 'Go to Reminders', icon: Bell, category: 'nav', action: () => go('/reminders') },
    { id: 'nav-reading', label: 'Go to Reading List', icon: BookOpen, category: 'nav', action: () => go('/reading') },
    { id: 'nav-settings', label: 'Go to Settings', icon: Settings, category: 'nav', action: () => go('/settings') },

    // Actions
    { id: 'new-task', label: 'New Task', icon: Plus, category: 'action', action: () => {
      setQuery('');
      setSubPrompt({ label: 'New Task', placeholder: 'Enter task title...', onSubmit: (t) => {
        api.post('/notes', { title: t, notebookId: 1, isTask: true }).then(() => {
          qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] });
        });
        onClose();
      }});
    }},
    { id: 'new-note', label: 'New Note', icon: Plus, category: 'action', action: () => {
      setQuery('');
      setSubPrompt({ label: 'New Note', placeholder: 'Enter note title...', onSubmit: (t) => {
        api.post('/notes', { title: t, notebookId: 1, isTask: false }).then(() => {
          qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] });
        });
        onClose();
      }});
    }},
    { id: 'search-emails', label: 'Search Emails', icon: Search, category: 'action', action: () => { go('/emails'); setTimeout(() => { const input = document.querySelector('.emails-list-header input') as HTMLInputElement; if (input) input.focus(); }, 200); } },
    { id: 'search-files', label: 'Scan Files', icon: Search, category: 'action', action: () => go('/files') },
    { id: 'chat', label: 'Open Chat', icon: MessageCircle, category: 'action', action: () => { onClose(); setTimeout(() => { const input = document.querySelector('.chat-input-bar textarea') as HTMLTextAreaElement; if (input) input.focus(); }, 100); } },

    // Window
    { id: 'win-sidecar', label: 'Switch to Sidecar', icon: Minimize2, category: 'window', shortcut: 'Alt+F', action: () => { try { (window as any).pai?.sidecar?.('right'); } catch {} onClose(); } },
    { id: 'win-full', label: 'Switch to Full Mode', icon: Maximize2, category: 'window', shortcut: 'Alt+F', action: () => { try { (window as any).pai?.maximize?.(); } catch {} onClose(); } },
    { id: 'win-hide', label: 'Hide Pai', icon: Moon, category: 'window', shortcut: 'Esc', action: () => { try { (window as any).pai?.hide?.(); } catch {} onClose(); } },
  ];

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setSubPrompt(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && filtered[selectedIdx]) {
      filtered[selectedIdx].action();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  const categories = [
    { key: 'action', label: 'Actions' },
    { key: 'nav', label: 'Navigation' },
    { key: 'window', label: 'Window' },
  ];

  let globalIdx = -1;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        {subPrompt ? (
          <>
            <div className="palette-category" style={{ padding: '12px 16px 4px' }}>{subPrompt.label}</div>
            <input
              className="palette-input"
              placeholder={subPrompt.placeholder}
              autoFocus
              ref={el => el?.focus()}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                  subPrompt.onSubmit((e.target as HTMLInputElement).value.trim());
                }
                if (e.key === 'Escape') setSubPrompt(null);
              }}
            />
          </>
        ) : (
        <>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-results">
          {categories.map(cat => {
            const items = filtered.filter(c => c.category === cat.key);
            if (items.length === 0) return null;
            return (
              <div key={cat.key}>
                <div className="palette-category">{cat.label}</div>
                {items.map(cmd => {
                  globalIdx++;
                  const idx = globalIdx;
                  const Icon = cmd.icon;
                  return (
                    <div
                      key={cmd.id}
                      className={`palette-item ${idx === selectedIdx ? 'active' : ''}`}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <Icon size={14} />
                      <span>{cmd.label}</span>
                      {cmd.shortcut && <kbd>{cmd.shortcut}</kbd>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="palette-empty">No commands found</div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
