import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Reminder } from '../../api/types';

export default function RemindersPage() {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('09:00');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState('daily');

  const { data: reminders = [] } = useQuery({
    queryKey: ['reminders', showAll],
    queryFn: () => api.get<Reminder[]>(`/reminders?all=${showAll}`),
  });

  const addMutation = useMutation({
    mutationFn: () => {
      const dueAt = new Date(`${dueDate}T${dueTime}`).toISOString();
      return api.post('/reminders', {
        title, description, dueAt, isRecurring,
        recurrenceRule: isRecurring ? recurrenceRule : null,
      });
    },
    onSuccess: () => {
      setTitle(''); setDescription(''); setDueDate(''); setDueTime('09:00');
      setIsRecurring(false);
      qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => api.post(`/reminders/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  const snoozeMutation = useMutation({
    mutationFn: (id: number) => api.post(`/reminders/${id}/snooze`, { minutes: 15 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  return (
    <div>
      <div className="section-header">
        <h2>Reminders</h2>
        <label className="checkbox">
          <input type="checkbox" checked={!showAll} onChange={e => setShowAll(!e.target.checked)} />
          Active only
        </label>
      </div>

      <div className="card-form">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>New Reminder</div>
        <div className="form-row">
          <input
            placeholder="Reminder title..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && title && dueDate && addMutation.mutate()}
          />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: 160 }} />
          <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} style={{ width: 100 }} />
          <button onClick={() => addMutation.mutate()} disabled={!title || !dueDate}>Add</button>
        </div>
        <div className="form-row mt-2">
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <label className="checkbox">
            <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
            Recurring
          </label>
          <select value={recurrenceRule} onChange={e => setRecurrenceRule(e.target.value)} disabled={!isRecurring} style={{ width: 100 }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      {reminders.map(r => {
        const isPast = new Date(r.dueAt) < new Date() && !r.isDismissed;
        return (
          <div key={r.id} className="card flex justify-between items-center">
            <div>
              <div style={{ fontWeight: 600, color: isPast ? 'var(--orange)' : 'inherit' }}>
                {r.title}
              </div>
              {r.description && <div className="text-small text-secondary">{r.description}</div>}
              <div className="text-xs text-muted mt-1">
                {new Date(r.dueAt).toLocaleString()}
                {r.isRecurring ? ` (${r.recurrenceRule})` : ''}
                {r.isDismissed ? ' - Dismissed' : ''}
              </div>
            </div>
            <div className="flex gap-2">
              {!r.isDismissed && (
                <>
                  <button className="ghost" onClick={() => api.post(`/reminders/${r.id}/test`)} title="Send notification now">Test</button>
                  <button className="ghost" onClick={() => snoozeMutation.mutate(r.id)}>Snooze</button>
                  <button className="secondary" onClick={() => dismissMutation.mutate(r.id)}>Dismiss</button>
                </>
              )}
              <button className="ghost" style={{ color: 'var(--red)' }} onClick={() => deleteMutation.mutate(r.id)}>Delete</button>
            </div>
          </div>
        );
      })}
      {reminders.length === 0 && <div className="text-muted">No reminders</div>}
    </div>
  );
}
