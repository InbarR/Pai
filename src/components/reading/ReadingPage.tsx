import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ReadingItem } from '../../api/types';

const priorityLabels = ['Low', 'Normal', 'High'];

export default function ReadingPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [priority, setPriority] = useState(1);

  const { data: items = [] } = useQuery({
    queryKey: ['reading', unreadOnly],
    queryFn: () => api.get<ReadingItem[]>(`/reading?unreadOnly=${unreadOnly}`),
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/reading', { title: title || url, url, priority }),
    onSuccess: () => {
      setTitle(''); setUrl(''); setPriority(1);
      qc.invalidateQueries({ queryKey: ['reading'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/reading/${id}/toggle-read`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reading'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reading/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reading'] }); qc.invalidateQueries({ queryKey: ['nav-counts'] }); },
  });

  return (
    <div>
      <div className="section-header">
        <h2>Reading List ({items.length})</h2>
        <label className="checkbox">
          <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      <div className="card-form">
        <div className="form-row">
          <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
          <input
            placeholder="URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (title || url) && addMutation.mutate()}
          />
          <select value={priority} onChange={e => setPriority(Number(e.target.value))} style={{ width: 100 }}>
            <option value={0}>Low</option>
            <option value={1}>Normal</option>
            <option value={2}>High</option>
          </select>
          <button onClick={() => addMutation.mutate()} disabled={!title && !url}>Add</button>
        </div>
      </div>

      {items.map(item => (
        <div key={item.id} className="card flex justify-between items-center">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600,
              textDecoration: item.isRead ? 'line-through' : 'none',
              opacity: item.isRead ? 0.5 : 1,
            }}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {item.title}
                </a>
              ) : item.title}
            </div>
            {item.url && (
              <div className="text-xs text-muted truncate mt-1">{item.url}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${item.priority === 2 ? 'high' : item.priority === 0 ? 'low' : ''}`}>
              {priorityLabels[item.priority]}
            </span>
            <span className="text-xs text-muted">{new Date(item.addedAt).toLocaleDateString()}</span>
            <button className="ghost" onClick={() => toggleMutation.mutate(item.id)}>
              {item.isRead ? 'Unread' : 'Read'}
            </button>
            <button className="ghost" style={{ color: 'var(--red)' }} onClick={() => deleteMutation.mutate(item.id)}>
              Del
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="text-muted">No items in reading list</div>}
    </div>
  );
}
