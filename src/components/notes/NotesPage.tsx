import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Note } from '../../api/types';
import {
  Plus, Search, Pin, Trash2, Circle, CheckCircle2,
  Calendar, MoreHorizontal, X, PinOff, ChevronDown, ChevronRight,
} from 'lucide-react';

type ContextMenuState = {
  x: number;
  y: number;
  id: number;
  showDatePicker?: boolean;
};

export default function NotesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [quickAdd, setQuickAdd] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', search],
    queryFn: () => {
      if (search) return api.get<Note[]>(`/notes/search?q=${encodeURIComponent(search)}`);
      return api.get<Note[]>('/notes');
    },
  });

  const tasks = allNotes
    .filter(n => n.isTask)
    .filter(n => showDone || n.taskStatus !== 2)
    .sort((a, b) => {
      if (!!b.isPinned !== !!a.isPinned) return b.isPinned ? 1 : -1;
      const at = a.taskStatus === 2 ? 1 : 0;
      const bt = b.taskStatus === 2 ? 1 : 0;
      if (at !== bt) return at - bt;
      return 0;
    });

  const openCount = allNotes.filter(n => n.isTask && n.taskStatus !== 2).length;
  const doneCount = allNotes.filter(n => n.isTask && n.taskStatus === 2).length;

  const handleQuickAdd = () => {
    const title = quickAdd.trim() || 'Untitled';
    api.post<Note>('/notes', {
      title,
      notebookId: 1,
      isTask: true,
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
      setQuickAdd('');
    });
  };

  const cycleStatus = useMutation({
    mutationFn: (id: number) => api.post<Note>(`/notes/${id}/toggle-done`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    },
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => api.post(`/notes/${id}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    },
  });

  const updateField = (id: number, patch: Partial<Note>) =>
    api.put(`/notes/${id}`, patch).then(() => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    });

  const startEditTitle = (note: Note) => {
    setEditingId(note.id);
    setEditingTitle(note.title);
  };

  const commitTitle = () => {
    if (editingId !== null) {
      const trimmed = editingTitle.trim();
      if (trimmed) updateField(editingId, { title: trimmed });
      setEditingId(null);
    }
  };

  const toggleExpand = (note: Note) => {
    if (expandedId === note.id) {
      setExpandedId(null);
    } else {
      setExpandedId(note.id);
      setNotesDraft(note.content?.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() || '');
    }
  };

  const saveNotes = useCallback((id: number, text: string) => {
    setNotesDraft(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const html = text.split('\n').map(p => `<p>${p}</p>`).join('');
      updateField(id, { content: html });
    }, 600);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.task-quick-add-input')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const activeForMenu = contextMenu ? allNotes.find(n => n.id === contextMenu.id) : null;

  const formatDue = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(d);
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 0 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="task-page">
      {/* Header: search + quick add */}
      <div className="task-header">
        <div className="task-header-row">
          <h2 className="task-page-title">Tasks</h2>
          <div className="task-search">
            <Search size={14} />
            <input
              placeholder="Search tasks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="task-quick-add">
          <Plus size={16} />
          <input
            className="task-quick-add-input"
            placeholder="Add a task and press Enter"
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
          />
        </div>

        <div className="task-toolbar">
          <span className="task-counts">
            <strong>{openCount}</strong> open · {doneCount} done
          </span>
          <button
            className={`task-toggle ${showDone ? 'on' : ''}`}
            onClick={() => setShowDone(!showDone)}
          >
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="task-list">
        {tasks.length === 0 && (
          <div className="task-empty">
            {search ? 'No matching tasks.' : 'No tasks yet. Add one above to get started.'}
          </div>
        )}
        {tasks.map(note => {
          const isDone = note.taskStatus === 2;
          const isExpanded = expandedId === note.id;
          const isEditing = editingId === note.id;
          return (
            <div
              key={note.id}
              className={`task-row ${isDone ? 'done' : ''} ${isExpanded ? 'expanded' : ''}`}
              onContextMenu={e => {
                e.preventDefault();
                const menuWidth = 220;
                const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
                setContextMenu({ x: Math.max(8, x), y: e.clientY, id: note.id });
              }}
            >
              <div className="task-row-main">
                <button
                  className={`task-row-check ${isDone ? 'checked' : ''}`}
                  onClick={() => cycleStatus.mutate(note.id)}
                  title={isDone ? 'Mark as open' : 'Mark as done'}
                >
                  {isDone ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                </button>

                {isEditing ? (
                  <input
                    autoFocus
                    className="task-row-edit-input"
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitTitle();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <div
                    className="task-row-title"
                    onClick={() => toggleExpand(note)}
                    onDoubleClick={() => startEditTitle(note)}
                    title="Click to expand · Double-click to rename"
                  >
                    {!!note.isPinned && <Pin size={11} className="task-row-pin" />}
                    {note.title || 'Untitled'}
                  </div>
                )}

                {note.dueDate && (
                  <span className={`task-row-due ${new Date(note.dueDate) < new Date(new Date().setHours(0, 0, 0, 0)) ? 'overdue' : ''}`}>
                    <Calendar size={11} /> {formatDue(note.dueDate)}
                  </span>
                )}

                <button
                  className="task-row-more"
                  onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const menuWidth = 220;
                    const x = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
                    setContextMenu({ x: Math.max(8, x), y: rect.bottom + 4, id: note.id });
                  }}
                  title="More actions"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>

              {isExpanded && (
                <div className="task-row-expanded">
                  {editingNotesId === note.id ? (
                    <textarea
                      autoFocus
                      className="task-row-notes"
                      placeholder="Add notes…"
                      value={notesDraft}
                      onChange={e => saveNotes(note.id, e.target.value)}
                      onBlur={() => setEditingNotesId(null)}
                    />
                  ) : (
                    <div
                      className="task-row-notes-view"
                      onClick={() => setEditingNotesId(note.id)}
                      title="Click to edit"
                    >
                      {notesDraft.trim() ? (
                        notesDraft.split('\n').map((line, i) => (
                          <div key={i} className="task-notes-line">{renderLineWithLinks(line)}</div>
                        ))
                      ) : (
                        <span className="task-notes-placeholder">Add notes…</span>
                      )}
                    </div>
                  )}
                  <div className="task-row-meta">
                    {note.createdAt && <span>Created {new Date(note.createdAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && activeForMenu && (
        <div
          className="context-menu task-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          {!contextMenu.showDatePicker ? (
            <>
              <button onClick={() => {
                cycleStatus.mutate(activeForMenu.id);
                setContextMenu(null);
              }}>
                {activeForMenu.taskStatus === 2 ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                {activeForMenu.taskStatus === 2 ? 'Mark as open' : 'Mark as done'}
              </button>
              <button onClick={() => {
                const note = allNotes.find(n => n.id === contextMenu.id);
                if (note) startEditTitle(note);
                setContextMenu(null);
              }}>
                <span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>✎</span>
                Rename
              </button>
              <hr />
              <button onClick={() => setContextMenu({ ...contextMenu, showDatePicker: true })}>
                <Calendar size={14} />
                {activeForMenu.dueDate ? `Due ${formatDue(activeForMenu.dueDate)}` : 'Set due date…'}
              </button>
              {activeForMenu.dueDate && (
                <button onClick={() => {
                  updateField(activeForMenu.id, { dueDate: null });
                  setContextMenu(null);
                }}>
                  <X size={14} /> Clear due date
                </button>
              )}
              <button onClick={() => {
                pinMutation.mutate(activeForMenu.id);
                setContextMenu(null);
              }}>
                {activeForMenu.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                {activeForMenu.isPinned ? 'Unpin' : 'Pin to top'}
              </button>
              <hr />
              <button className="danger-item" onClick={() => {
                if (confirm(`Delete "${activeForMenu.title || 'Untitled'}"?`)) {
                  deleteMutation.mutate(activeForMenu.id);
                }
                setContextMenu(null);
              }}>
                <Trash2 size={14} /> Delete
              </button>
            </>
          ) : (
            <div className="task-context-datepicker">
              <div className="task-context-date-quicks">
                <button onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  updateField(activeForMenu.id, { dueDate: today });
                  setContextMenu(null);
                }}>Today</button>
                <button onClick={() => {
                  const t = new Date(); t.setDate(t.getDate() + 1);
                  updateField(activeForMenu.id, { dueDate: t.toISOString().split('T')[0] });
                  setContextMenu(null);
                }}>Tomorrow</button>
                <button onClick={() => {
                  const t = new Date(); t.setDate(t.getDate() + 7);
                  updateField(activeForMenu.id, { dueDate: t.toISOString().split('T')[0] });
                  setContextMenu(null);
                }}>Next week</button>
              </div>
              <input
                type="date"
                className="task-context-date-input"
                value={activeForMenu.dueDate || ''}
                onChange={e => {
                  updateField(activeForMenu.id, { dueDate: e.target.value || null });
                  setContextMenu(null);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderLineWithLinks(text: string) {
  if (!text) return '\u00A0';
  const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
  const parts: (string | JSX.Element)[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const url = match[1];
    parts.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
      >
        {url}
      </a>
    );
    lastIdx = match.index + url.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}
