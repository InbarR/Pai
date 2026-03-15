import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { TaskItem, TaskStatus } from '../../api/types';

const statusLabel = ['To Do', 'In Progress', 'Done'];
const statusClass = ['todo', 'in-progress', 'done'];

export default function TasksPage() {
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [clipText, setClipText] = useState('');
  const [showClip, setShowClip] = useState(false);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', openOnly],
    queryFn: () => api.get<TaskItem[]>(`/tasks?openOnly=${openOnly}`),
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/tasks', { title, dueDate: dueDate || null }),
    onSuccess: () => {
      setTitle(''); setDueDate('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const cycleMutation = useMutation({
    mutationFn: (id: number) => api.post(`/tasks/${id}/cycle-status`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const clipMutation = useMutation({
    mutationFn: () => api.post('/tasks/from-clipboard', { text: clipText }),
    onSuccess: () => {
      setClipText('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <div>
      <div className="section-header">
        <h2>Tasks</h2>
        <label className="checkbox">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
          Hide completed
        </label>
      </div>

      <div className="card-form">
        <div className="form-row">
          <input
            placeholder="New task..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && title && addMutation.mutate()}
          />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: 160 }} />
          <button onClick={() => addMutation.mutate()} disabled={!title}>Add</button>
        </div>
      </div>

      {tasks.map(task => (
        <div key={task.id} className="card flex items-center gap-3">
          <div
            className={`status-dot ${statusClass[task.status]}`}
            onClick={() => cycleMutation.mutate(task.id)}
            title="Click to cycle status"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14 }}>{task.title}</div>
            <div className="text-xs text-muted mt-1">
              {task.dueDate && `Due: ${new Date(task.dueDate).toLocaleDateString()}`}
              {task.dueDate && task.sourceType !== 'manual' && ' | '}
              {task.sourceType !== 'manual' && <span style={{ color: 'var(--text-muted)' }}>{task.sourceType}</span>}
            </div>
          </div>
          <span className={`badge ${statusClass[task.status]}`}>{statusLabel[task.status]}</span>
          <button className="ghost" style={{ color: 'var(--red)' }} onClick={() => deleteMutation.mutate(task.id)}>
            Del
          </button>
        </div>
      ))}
      {tasks.length === 0 && <div className="text-muted mb-4">No tasks</div>}

      <div className="mt-4">
        <button className="secondary" onClick={() => setShowClip(!showClip)}>
          {showClip ? 'Hide' : 'Add tasks from clipboard'}
        </button>
        {showClip && (
          <div className="card-form mt-2">
            <textarea
              placeholder="Paste email or Teams message here..."
              value={clipText}
              onChange={e => setClipText(e.target.value)}
              style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
            />
            <div className="mt-2" style={{ textAlign: 'right' }}>
              <button onClick={() => clipMutation.mutate()} disabled={!clipText.trim()}>
                Extract Tasks
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
