import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Note } from '../../api/types';
import NoteEditor from './NoteEditor';
import {
  Plus, Search, Pin, Trash2, CheckSquare, Circle, CheckCircle2,
  Calendar, PlayCircle, X, Upload, Bell, Edit3,
} from 'lucide-react';

const statusIcons = [Circle, PlayCircle, CheckCircle2];
const statusLabels = ['To Do', 'In Progress', 'Done'];
const statusClasses = ['todo', 'in-progress', 'done'];

export default function NotesPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [quickAdd, setQuickAdd] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', search],
    queryFn: () => {
      if (search) return api.get<Note[]>(`/notes/search?q=${encodeURIComponent(search)}`);
      return api.get<Note[]>('/notes');
    },
  });

  // Show only tasks; optionally include done
  const tasks = allNotes.filter(n => n.isTask)
    .filter(n => showDone || n.taskStatus !== 2);

  const active = allNotes.find(n => n.id === activeId);
  const openCount = allNotes.filter(n => n.isTask && n.taskStatus !== 2).length;
  const doneCount = allNotes.filter(n => n.isTask && n.taskStatus === 2).length;

  const selectNote = useCallback((note: Note) => {
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
  }, []);

  const autoSave = useCallback((newContent: string) => {
    setContent(newContent);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (activeId) {
        api.put(`/notes/${activeId}`, { content: newContent }).then(() =>
          qc.invalidateQueries({ queryKey: ['notes'] })
        );
      }
    }, 1000);
  }, [activeId, qc]);

  const autoSaveTitle = useCallback((newTitle: string) => {
    setTitle(newTitle);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (activeId) {
        api.put(`/notes/${activeId}`, { title: newTitle }).then(() =>
          qc.invalidateQueries({ queryKey: ['notes'] })
        );
      }
    }, 600);
  }, [activeId, qc]);

  // Quick add — always creates a task
  const handleQuickAdd = () => {
    const title = quickAdd.trim() || 'Untitled';
    api.post<Note>('/notes', {
      title,
      notebookId: 1,
      isTask: true,
    }).then(note => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
      setQuickAdd('');
      selectNote(note);
    });
  };

  // Import from file
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,.txt,.md';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files) return;
      for (const file of Array.from(input.files)) {
        const text = await file.text();
        const title = file.name.replace(/\.(html?|txt|md)$/i, '');
        const isHtml = /\.html?$/i.test(file.name);
        const content = isHtml ? text : `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
        await api.post('/notes', { title, content, notebookId: 1, isTask: true });
      }
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    };
    input.click();
  };

  const cycleStatus = useMutation({
    mutationFn: (id: number) => api.post<Note>(`/notes/${id}/toggle-done`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); },
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => api.post(`/notes/${id}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: (_, id) => {
      if (activeId === id) { setActiveId(null); setContent(''); }
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); document.querySelector<HTMLInputElement>('.quick-add-input')?.focus(); }
      if (e.key === 'Delete' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName || '')) {
        if (selected.size > 0) {
          selected.forEach(id => deleteMutation.mutate(id));
          setSelected(new Set());
          setActiveId(null);
        } else if (activeId) {
          deleteMutation.mutate(activeId);
          setActiveId(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeId, selected]);

  useEffect(() => {
    const handler = () => { setContextMenu(null); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  return (
    <div className="notes-layout notes-layout-simple">
      {/* Task list */}
      <div className="todo-list-panel">
        {/* Quick add */}
        <div className="todo-quick-add">
          <input
            className="quick-add-input"
            placeholder="Add a task… or press + to create empty"
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
          />
          <button className="btn-add" onClick={handleQuickAdd} title={quickAdd.trim() ? 'Add task' : 'Create new empty task'}>
            <Plus size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="todo-tabs">
          <span className="task-count-label">{openCount} open{doneCount > 0 ? `, ${doneCount} done` : ''}</span>
          <button className={`todo-tab ${showDone ? 'active' : ''}`} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide done' : 'Show done'}
          </button>
          <div style={{ marginLeft: 'auto' }}>
            <div className="notes-search" style={{ width: 160 }}>
              <Search size={12} className="notes-search-icon" />
              <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '4px 4px 4px 26px' }} />
            </div>
          </div>
        </div>

        {/* Task list */}
        <div className="todo-list-scroll">
          {tasks.map(note => {
            const StatusIcon = statusIcons[note.taskStatus];
            const isActive = activeId === note.id;
            return (
              <div
                key={note.id}
                className={`todo-item ${isActive ? 'active' : ''} ${selected.has(note.id) ? 'selected' : ''} ${note.taskStatus === 2 ? 'done' : ''}`}
                onClick={e => {
                  if (e.ctrlKey || e.metaKey) {
                    setSelected(prev => { const n = new Set(prev); n.has(note.id) ? n.delete(note.id) : n.add(note.id); return n; });
                  } else {
                    setSelected(new Set());
                    selectNote(note);
                  }
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  if (selected.size === 0) setSelected(new Set([note.id]));
                  setContextMenu({ x: e.clientX, y: e.clientY, id: note.id });
                }}
              >
                <button
                  className={`todo-status ${statusClasses[note.taskStatus]}`}
                  onClick={e => { e.stopPropagation(); cycleStatus.mutate(note.id); }}
                  title={statusLabels[note.taskStatus]}
                >
                  <StatusIcon size={18} />
                </button>
                <div className="todo-content">
                  <div className="todo-title">{note.title || 'Untitled'}</div>
                  <div className="todo-meta">
                    {note.dueDate && <span className="todo-due"><Calendar size={10} /> {new Date(note.dueDate).toLocaleDateString()}</span>}
                    {note.isPinned ? <Pin size={10} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {tasks.length === 0 && <div className="empty-inline">
            {search ? 'No matches' : 'No tasks yet. Add one above!'}
          </div>}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={e => e.stopPropagation()}>
          {selected.size > 1 ? (
            <>
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>{selected.size} selected</div>
              <button className="danger-item" onClick={() => {
                selected.forEach(id => deleteMutation.mutate(id));
                setSelected(new Set()); setContextMenu(null); setActiveId(null);
              }}>Delete {selected.size} items</button>
            </>
          ) : (() => {
            const note = allNotes.find(n => n.id === contextMenu.id);
            return (<>
              {!!note?.isTask && note.taskStatus === 2 && (
                <button onClick={() => {
                  api.put(`/notes/${contextMenu.id}`, { taskStatus: 0 }).then(() => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); });
                  setContextMenu(null); setSelected(new Set());
                }}>Reopen task</button>
              )}
              <button onClick={() => { pinMutation.mutate(contextMenu.id); setContextMenu(null); setSelected(new Set()); }}>
                {note?.isPinned ? 'Unpin' : 'Pin to top'}
              </button>
              <hr />
              <button className="danger-item" onClick={() => { deleteMutation.mutate(contextMenu.id); setContextMenu(null); setSelected(new Set()); }}>Delete</button>
            </>);
          })()}
        </div>
      )}

      {/* Detail pane */}
      <div className={`todo-detail-panel${active ? '' : ' hidden'}`}>
        {active ? (
          <>
            <div className="todo-detail-header">
              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                <button className={`note-status-btn ${statusClasses[active.taskStatus]}`}
                  onClick={() => cycleStatus.mutate(active.id)}
                  title={active.taskStatus === 2 ? 'Mark as To Do' : 'Mark as Done'}>
                  {statusLabels[active.taskStatus]}
                </button>
                <div className="note-due-picker">
                  <Calendar size={12} />
                  <input type="date" value={active.dueDate || ''}
                    onChange={e => { api.put(`/notes/${active.id}`, { dueDate: e.target.value || null }).then(() => qc.invalidateQueries({ queryKey: ['notes'] })); }} />
                </div>
                <button className="ghost" onClick={() => setActiveId(null)} style={{ marginLeft: 'auto' }}><X size={16} /></button>
              </div>
              <input className="note-title-input" value={title} onChange={e => autoSaveTitle(e.target.value)} placeholder="Untitled" />
            </div>
            <div className="note-meta-bar">
              {active.createdAt && <span>Created {new Date(active.createdAt).toLocaleDateString()} {new Date(active.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              {active.updatedAt && active.updatedAt !== active.createdAt && (
                <span>Modified {new Date(active.updatedAt).toLocaleDateString()} {new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
            <NoteEditor content={content} onChange={autoSave} />
          </>
        ) : (
          <div className="note-editor-empty">Select a task to see details</div>
        )}
      </div>
    </div>
  );
}
