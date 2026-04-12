import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Note } from '../../api/types';
import NoteEditor from './NoteEditor';
import {
  Plus, Search, Pin, Trash2, FolderPlus, Book, CheckSquare, Circle, CheckCircle2,
  Calendar, PlayCircle, StickyNote, X, Upload, Bell, Edit3,
} from 'lucide-react';

interface Notebook { id: number; name: string; icon: string; noteCount: number; }

const statusIcons = [Circle, PlayCircle, CheckCircle2];
const statusLabels = ['To Do', 'In Progress', 'Done'];
const statusClasses = ['todo', 'in-progress', 'done'];

export default function NotesPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [activeNotebook, setActiveNotebook] = useState<number | null>(null);
  const [view, setView] = useState<'all' | 'tasks' | 'notes' | 'done' | 'reminders'>('all');
  const [quickAdd, setQuickAdd] = useState('');
  const [quickIsTask, setQuickIsTask] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [nbContextMenu, setNbContextMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [renamingNb, setRenamingNb] = useState<number | null>(null);
  const [renameNbValue, setRenameNbValue] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showOneNote, setShowOneNote] = useState(false);
  const [oneNoteBooks, setOneNoteBooks] = useState<any[]>([]);
  const [oneNotePages, setOneNotePages] = useState<any[]>([]);
  const [oneNoteSectionId, setOneNoteSectionId] = useState<string | null>(null);
  const [importingPages, setImportingPages] = useState<Set<string>>(new Set());
  const [dragOverNb, setDragOverNb] = useState<number | null>(null);
  const renameNbRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingReminder, setEditingReminder] = useState<any | null>(null);

  const { data: notebooks = [] } = useQuery({
    queryKey: ['notebooks'],
    queryFn: () => api.get<Notebook[]>('/notes/notebooks'),
  });

  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', search, activeNotebook],
    queryFn: () => {
      if (search) return api.get<Note[]>(`/notes/search?q=${encodeURIComponent(search)}`);
      if (activeNotebook) return api.get<Note[]>(`/notes?notebookId=${activeNotebook}`);
      return api.get<Note[]>('/notes');
    },
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => api.get<any[]>('/reminders'),
  });
  const activeReminders = reminders.filter((r: any) => !r.isDismissed);

  // Filter by view
  const notes = view === 'tasks' ? allNotes.filter(n => n.isTask && n.taskStatus !== 2)
    : view === 'notes' ? allNotes.filter(n => !n.isTask)
    : view === 'done' ? allNotes.filter(n => n.isTask && n.taskStatus === 2)
    : view === 'reminders' ? [] // handled separately
    : allNotes.filter(n => !(n.isTask && n.taskStatus === 2)); // 'all' hides done

  const active = allNotes.find(n => n.id === activeId);
  const taskCount = allNotes.filter(n => n.isTask && n.taskStatus !== 2).length;
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

  // Quick add
  const handleQuickAdd = () => {
    const title = quickAdd.trim() || 'Untitled';
    api.post<Note>('/notes', {
      title,
      notebookId: activeNotebook || 1,
      isTask: quickIsTask,
    }).then(note => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['notebooks'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
      setQuickAdd('');
      selectNote(note);
    });
  };

  // Drag and drop handler — create note from dropped data
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drop-active');
    const json = e.dataTransfer.getData('application/json');
    if (!json) return;
    try {
      const data = JSON.parse(json);
      let title = '';
      let content = '';
      let isTask = true;

      if (data.type === 'email') {
        title = `RE: ${data.subject}`;
        content = `<p><strong>From:</strong> ${data.from}</p><p><strong>Date:</strong> ${data.date}</p><hr><p>${data.preview || ''}</p>`;
        isTask = true;
      } else if (data.type === 'meeting' || data.type === 'event') {
        title = data.subject || data.title || 'Meeting note';
        content = `<p><strong>Meeting:</strong> ${data.subject || data.title}</p><p><strong>Time:</strong> ${data.start} - ${data.end}</p>${data.attendees ? `<p><strong>Attendees:</strong> ${data.attendees}</p>` : ''}<hr><p></p>`;
        isTask = true;
      } else if (data.type === 'file') {
        title = data.title || data.name || 'File note';
        content = `<p><strong>File:</strong> ${data.path || data.url || ''}</p><hr><p></p>`;
        isTask = false;
      }

      if (title) {
        api.post<Note>('/notes', {
          title,
          content,
          notebookId: activeNotebook || 1,
          isTask,
        }).then(note => {
          qc.invalidateQueries({ queryKey: ['notes'] });
          qc.invalidateQueries({ queryKey: ['nav-counts'] });
          selectNote(note);
        });
      }
    } catch {}
  }, [activeNotebook, qc]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('drop-active');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('drop-active');
  };

  // Import from file (HTML, TXT, or OneNote export)
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
        await api.post('/notes', { title, content, notebookId: activeNotebook || 1, isTask: false });
      }
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
    };
    input.click();
  };

  const cycleStatus = useMutation({
    mutationFn: (id: number) => api.post<Note>(`/notes/${id}/toggle-done`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); qc.invalidateQueries({ queryKey: ['notebooks'] }); },
  });

  const toggleTask = useMutation({
    mutationFn: (id: number) => api.post<Note>(`/notes/${id}/toggle-task`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); qc.invalidateQueries({ queryKey: ['notebooks'] }); },
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
      qc.invalidateQueries({ queryKey: ['notebooks'] });
    },
  });

  const moveToNotebook = useMutation({
    mutationFn: ({ noteIds, notebookId }: { noteIds: number[]; notebookId: number }) =>
      Promise.all(noteIds.map(id => api.put(`/notes/${id}`, { notebookId }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['notebooks'] });
      qc.invalidateQueries({ queryKey: ['nav-counts'] });
      setSelected(new Set());
    },
  });

  const addNotebookMutation = useMutation({
    mutationFn: () => api.post<Notebook>('/notes/notebooks', { name: 'New Notebook' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });

  const renameNotebookMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.put(`/notes/notebooks/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notebooks'] }),
  });

  const deleteNotebookMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/notebooks/${id}`),
    onSuccess: (_, id) => {
      if (activeNotebook === id) setActiveNotebook(null);
      qc.invalidateQueries({ queryKey: ['notebooks'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); document.querySelector<HTMLInputElement>('.quick-add-input')?.focus(); }
      // Delete key deletes selected or active note/task
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
    const handler = () => { setContextMenu(null); setNbContextMenu(null); };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (renamingNb && renameNbRef.current) { renameNbRef.current.focus(); renameNbRef.current.select(); }
  }, [renamingNb]);

  return (
    <div className="notes-layout">
      {/* Notebooks sidebar */}
      <div className="notebooks-panel">
        <div style={{ padding: '10px 10px 6px' }}>
          <div className="flex justify-between items-center">
            <span className="section-label">Lists</span>
            <button className="btn-icon" onClick={() => addNotebookMutation.mutate()}><FolderPlus size={13} /></button>
          </div>
        </div>
        <div className={`notebook-item ${activeNotebook === null ? 'active' : ''}`} onClick={() => setActiveNotebook(null)}>
          <Book size={13} /> <span className="flex-1">All</span>
          <span className="notebook-count">{allNotes.filter(n => !(n.isTask && n.taskStatus === 2)).length}</span>
        </div>
        {notebooks.map(nb => (
          <div
            key={nb.id}
            className={`notebook-item ${activeNotebook === nb.id ? 'active' : ''} ${dragOverNb === nb.id ? 'drop-target' : ''}`}
            onClick={() => setActiveNotebook(nb.id)}
            onContextMenu={e => { e.preventDefault(); setNbContextMenu({ x: e.clientX, y: e.clientY, id: nb.id }); }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverNb(nb.id); }}
            onDragLeave={() => setDragOverNb(null)}
            onDrop={e => {
              e.preventDefault();
              setDragOverNb(null);
              const json = e.dataTransfer.getData('application/x-note-ids');
              if (json) {
                try {
                  const ids = JSON.parse(json) as number[];
                  moveToNotebook.mutate({ noteIds: ids, notebookId: nb.id });
                } catch {}
              }
            }}
          >
            <Book size={13} />
            {renamingNb === nb.id ? (
              <input ref={renameNbRef} value={renameNbValue} onChange={e => setRenameNbValue(e.target.value)}
                onBlur={() => { if (renameNbValue.trim()) renameNotebookMutation.mutate({ id: nb.id, name: renameNbValue.trim() }); setRenamingNb(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { renameNotebookMutation.mutate({ id: nb.id, name: renameNbValue.trim() }); setRenamingNb(null); } if (e.key === 'Escape') setRenamingNb(null); }}
                onClick={e => e.stopPropagation()} style={{ flex: 1, fontSize: 12, padding: '1px 4px', minWidth: 0 }} />
            ) : <span className="flex-1 truncate">{nb.name}</span>}
            <span className="notebook-count">{nb.noteCount}</span>
          </div>
        ))}
        {nbContextMenu && (
          <div className="context-menu" style={{ top: nbContextMenu.y, left: nbContextMenu.x }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { const nb = notebooks.find(n => n.id === nbContextMenu.id); if (nb) { setRenamingNb(nb.id); setRenameNbValue(nb.name); } setNbContextMenu(null); }}>Rename</button>
            {nbContextMenu.id !== 1 && <><hr /><button className="danger-item" onClick={() => { deleteNotebookMutation.mutate(nbContextMenu.id); setNbContextMenu(null); }}>Delete</button></>}
          </div>
        )}
      </div>

      {/* Main list */}
      <div className="todo-list-panel" onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
        {/* Quick add */}
        <div className="todo-quick-add">
          <button className={`todo-type-toggle ${quickIsTask ? 'task' : 'note'}`}
            onClick={() => setQuickIsTask(!quickIsTask)} title={quickIsTask ? 'Switch to note' : 'Switch to task'}>
            {quickIsTask ? <CheckSquare size={16} /> : <StickyNote size={16} />}
          </button>
          <input
            className="quick-add-input"
            placeholder={quickIsTask ? 'Add a task… or press + to create empty' : 'Add a note… or press + to create empty'}
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
          />
          <button className="btn-add" onClick={handleQuickAdd} title={quickAdd.trim() ? 'Add task' : 'Create new empty task'}>
            <Plus size={16} />
          </button>
          <button className="ghost" onClick={handleImport} title="Import from file" aria-label="Import from file" style={{ padding: '4px 8px' }}>
            <Upload size={16} />
          </button>
          <button className="ghost" onClick={async () => {
            setShowOneNote(true);
            try {
              const books = await api.get<any[]>('/notes/onenote/notebooks');
              setOneNoteBooks(books);
            } catch { setOneNoteBooks([]); }
          }} title="Import from OneNote" aria-label="Import from OneNote" style={{ padding: '4px 8px' }}>
            <Book size={16} />
          </button>
        </div>

        {/* View tabs */}
        <div className="todo-tabs">
          <button className={`todo-tab ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>All</button>
          <button className={`todo-tab ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}>
            Tasks ({taskCount})
          </button>
          <button className={`todo-tab ${view === 'notes' ? 'active' : ''}`} onClick={() => setView('notes')}>Notes</button>
          <button className={`todo-tab ${view === 'done' ? 'active' : ''}`} onClick={() => setView('done')}>Done ({doneCount})</button>
          <button className={`todo-tab ${view === 'reminders' ? 'active' : ''}`} onClick={() => setView('reminders')}>
            <Bell size={12} /> Reminders ({activeReminders.length})
          </button>
          <div style={{ marginLeft: 'auto' }}>
            <div className="notes-search" style={{ width: 160 }}>
              <Search size={12} className="notes-search-icon" />
              <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '4px 4px 4px 26px' }} />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="todo-list-scroll">
          {/* Reminders shown in All, Tasks, and Reminders views */}
          {(view === 'all' || view === 'tasks' || view === 'reminders') && activeReminders.map((r: any) => {
            const isOverdue = new Date(r.dueAt) < new Date();
            return (
              <div key={`rem-${r.id}`} className={`todo-item ${isOverdue ? 'overdue' : ''}`}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, id: -r.id }); }}>
                <button className="todo-status reminder-status" title="Dismiss"
                  onClick={() => { api.post(`/reminders/${r.id}/dismiss`).then(() => { qc.invalidateQueries({ queryKey: ['reminders'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); }); }}>
                  <Bell size={16} />
                </button>
                <div className="todo-content" style={{ flex: 1 }}>
                  <div className="todo-title">{r.title}</div>
                  <div className="todo-meta">
                    <span className={`todo-due ${isOverdue ? 'overdue' : ''}`}>
                      <Calendar size={10} /> {new Date(r.dueAt).toLocaleString()}
                    </span>
                    {r.description && <span>{r.description}</span>}
                  </div>
                </div>
                <button className="ghost" title="Edit" onClick={() => setEditingReminder(r)}
                  style={{ padding: '4px', flexShrink: 0 }}>
                  <Edit3 size={14} />
                </button>
              </div>
            );
          })}
          {view === 'reminders' && activeReminders.length === 0 && (
            <div className="text-muted text-small" style={{ padding: 24, textAlign: 'center' }}>No active reminders</div>
          )}
          {(view === 'all' || view === 'tasks') && activeReminders.length > 0 && notes.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          )}

          {/* Notes/Tasks list */}
          {view !== 'reminders' && notes.map(note => {
            const StatusIcon = note.isTask ? statusIcons[note.taskStatus] : StickyNote;
            const isActive = activeId === note.id;
            return (
              <div
                key={note.id}
                className={`todo-item ${isActive ? 'active' : ''} ${selected.has(note.id) ? 'selected' : ''} ${note.isTask && note.taskStatus === 2 ? 'done' : ''}`}
                draggable
                onDragStart={e => {
                  const ids = selected.size > 0 && selected.has(note.id) ? Array.from(selected) : [note.id];
                  e.dataTransfer.setData('application/x-note-ids', JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={e => {
                  if (e.ctrlKey || e.metaKey) {
                    setSelected(prev => { const n = new Set(prev); n.has(note.id) ? n.delete(note.id) : n.add(note.id); return n; });
                  } else if (selected.size > 0) {
                    setSelected(new Set());
                    selectNote(note);
                  } else {
                    selectNote(note);
                  }
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  if (selected.size > 0 && !selected.has(note.id)) {
                    setSelected(prev => new Set(prev).add(note.id));
                  } else if (selected.size === 0) {
                    setSelected(new Set([note.id]));
                  }
                  setContextMenu({ x: e.clientX, y: e.clientY, id: note.id });
                }}
              >
                <button
                  className={`todo-status ${note.isTask ? statusClasses[note.taskStatus] : 'note'}`}
                  onClick={e => { e.stopPropagation(); if (note.isTask) cycleStatus.mutate(note.id); }}
                  title={note.isTask ? statusLabels[note.taskStatus] : 'Note'}
                >
                  <StatusIcon size={18} />
                </button>
                <div className="todo-content">
                  <div className="todo-title">{note.title || 'Untitled'}</div>
                  <div className="todo-meta">
                    {note.dueDate && <span className="todo-due"><Calendar size={10} /> {new Date(note.dueDate).toLocaleDateString()}</span>}
                    {note.isPinned ? <Pin size={10} /> : null}
                    {note.tags && <span className="todo-tags">{note.tags}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {view !== 'reminders' && notes.length === 0 && <div className="empty-inline">
            {search ? 'No matches' : view === 'done' ? 'No completed tasks' : 'Nothing here yet. Add one above!'}
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
            const isReminder = contextMenu.id < 0;
            const reminderId = -contextMenu.id;
            if (isReminder) {
              return (<>
                <button onClick={() => {
                  api.post(`/reminders/${reminderId}/dismiss`).then(() => { qc.invalidateQueries({ queryKey: ['reminders'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); });
                  setContextMenu(null);
                }}>Dismiss reminder</button>
                <hr />
                <button className="danger-item" onClick={() => {
                  api.delete(`/reminders/${reminderId}`).then(() => { qc.invalidateQueries({ queryKey: ['reminders'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); });
                  setContextMenu(null);
                }}>Delete</button>
              </>);
            }
            const note = allNotes.find(n => n.id === contextMenu.id);
            return (<>
              {!!note?.isTask && note.taskStatus === 2 && (
                <button onClick={() => {
                  api.put(`/notes/${contextMenu.id}`, { taskStatus: 0 }).then(() => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); });
                  setContextMenu(null); setSelected(new Set());
                }}>Reopen task</button>
              )}
              <button onClick={() => { toggleTask.mutate(contextMenu.id); setContextMenu(null); setSelected(new Set()); }}>
                {note?.isTask ? 'Convert to note' : 'Convert to task'}
              </button>
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
                {active.isTask && (
                  <button className={`note-status-btn ${statusClasses[active.taskStatus]}`}
                    onClick={() => cycleStatus.mutate(active.id)}
                    title={active.taskStatus === 2 ? 'Mark as To Do' : 'Mark as Done'}>
                    {statusLabels[active.taskStatus]}
                  </button>
                )}
                {!active.isTask && <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>Note</span>}
                {active.isTask && (
                  <div className="note-due-picker">
                    <Calendar size={12} />
                    <input type="date" value={active.dueDate || ''}
                      onChange={e => { api.put(`/notes/${active.id}`, { dueDate: e.target.value || null }).then(() => qc.invalidateQueries({ queryKey: ['notes'] })); }} />
                  </div>
                )}
                <button className="ghost" onClick={() => setActiveId(null)} style={{ marginLeft: 'auto' }}><X size={16} /></button>
              </div>
              <input className="note-title-input" value={title} onChange={e => autoSaveTitle(e.target.value)} placeholder="Untitled" />
            </div>
            <div className="note-meta-bar">
              {active.createdAt && <span>Created {new Date(active.createdAt).toLocaleDateString()} {new Date(active.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              {active.updatedAt && active.updatedAt !== active.createdAt && (
                <span>Modified {new Date(active.updatedAt).toLocaleDateString()} {new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
              {active.sourceType && <span>Source: {active.sourceType}</span>}
            </div>
            <NoteEditor content={content} onChange={autoSave} />
          </>
        ) : (
          <div className="note-editor-empty">Select an item to see details</div>
        )}
      </div>

      {/* Edit reminder dialog */}
      {editingReminder && (
        <div className="palette-overlay" onClick={() => setEditingReminder(null)}>
          <div className="palette" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Edit Reminder</div>
              <input className="palette-input" defaultValue={editingReminder.title} placeholder="Title"
                ref={el => el?.focus()}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const titleInput = e.target as HTMLInputElement;
                    const form = titleInput.closest('.palette')!;
                    const dateInput = form.querySelector('input[type="datetime-local"]') as HTMLInputElement;
                    const descInput = form.querySelector('textarea') as HTMLTextAreaElement;
                    api.put(`/reminders/${editingReminder.id}`, {
                      title: titleInput.value,
                      dueAt: dateInput?.value ? new Date(dateInput.value).toISOString() : editingReminder.dueAt,
                      description: descInput?.value || '',
                    }).then(() => { qc.invalidateQueries({ queryKey: ['reminders'] }); setEditingReminder(null); });
                  }
                  if (e.key === 'Escape') setEditingReminder(null);
                }} />
              <input type="datetime-local" defaultValue={editingReminder.dueAt?.substring(0, 16)}
                style={{ padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }} />
              <textarea defaultValue={editingReminder.description || ''} placeholder="Description (optional)"
                rows={2}
                style={{ padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost" onClick={() => setEditingReminder(null)} style={{ flex: 1, padding: 8 }}>Cancel</button>
                <button style={{ flex: 1, padding: 8, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  onClick={() => {
                    const form = document.querySelector('.palette')!;
                    const titleInput = form.querySelector('.palette-input') as HTMLInputElement;
                    const dateInput = form.querySelector('input[type="datetime-local"]') as HTMLInputElement;
                    const descInput = form.querySelector('textarea') as HTMLTextAreaElement;
                    api.put(`/reminders/${editingReminder.id}`, {
                      title: titleInput?.value || editingReminder.title,
                      dueAt: dateInput?.value ? new Date(dateInput.value).toISOString() : editingReminder.dueAt,
                      description: descInput?.value || '',
                    }).then(() => { qc.invalidateQueries({ queryKey: ['reminders'] }); setEditingReminder(null); });
                  }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OneNote import dialog */}
      {showOneNote && (
        <div className="palette-overlay" onClick={() => { setShowOneNote(false); setOneNotePages([]); setOneNoteSectionId(null); }}>
          <div className="palette" onClick={e => e.stopPropagation()} style={{ maxHeight: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Import from OneNote</span>
              <button className="ghost" onClick={() => { setShowOneNote(false); setOneNotePages([]); setOneNoteSectionId(null); }}><X size={14} /></button>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 0' }}>
              {!oneNoteSectionId ? (
                // Show notebooks & sections
                oneNoteBooks.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Loading OneNote notebooks... (OneNote must be installed)
                  </div>
                ) : oneNoteBooks.map((nb: any) => (
                  <div key={nb.id}>
                    <div style={{ padding: '8px 16px', fontWeight: 600, fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase' }}>{nb.name}</div>
                    {(nb.sections || []).map((sec: any) => (
                      <div key={sec.id} className="palette-item" onClick={async () => {
                        setOneNoteSectionId(sec.id);
                        const pages = await api.get<any[]>(`/notes/onenote/pages/${encodeURIComponent(sec.id)}`);
                        setOneNotePages(pages);
                      }}>
                        <Book size={14} />
                        <span>{sec.name}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                // Show pages in selected section
                <>
                  <div className="palette-item" onClick={() => { setOneNoteSectionId(null); setOneNotePages([]); }}
                    style={{ color: 'var(--accent)', fontSize: 12 }}>
                    &larr; Back to notebooks
                  </div>
                  {oneNotePages.map((page: any) => (
                    <div key={page.id} className="palette-item" onClick={async () => {
                      if (importingPages.has(page.id)) return;
                      setImportingPages(prev => new Set(prev).add(page.id));
                      await api.post('/notes/onenote/import', { pageId: page.id, notebookId: activeNotebook || 1 });
                      qc.invalidateQueries({ queryKey: ['notes'] });
                      qc.invalidateQueries({ queryKey: ['nav-counts'] });
                    }}>
                      <span style={{ flex: 1 }}>{page.name}</span>
                      {importingPages.has(page.id)
                        ? <span style={{ fontSize: 11, color: 'var(--accent)' }}>Imported!</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click to import</span>
                      }
                    </div>
                  ))}
                  {oneNotePages.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages found</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
