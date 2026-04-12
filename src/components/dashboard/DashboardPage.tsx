import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { DashboardData } from '../../api/types';
import { Bell, CheckSquare, BookOpen, Mail, StickyNote, Plus, ArrowRight, Clock, AlertTriangle, Calendar, Video, MapPin, ExternalLink } from 'lucide-react';

const statusLabel = ['To Do', 'In Progress', 'Done'];
const statusClass = ['todo', 'in-progress', 'done'];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

function getTimeOfDay(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function getSmartSummary(data: DashboardData): string[] {
  const tips: string[] = [];
  const overdueReminders = data.upcomingReminders.filter(r => new Date(r.dueAt) < new Date());

  if (overdueReminders.length > 0)
    tips.push(`You have ${overdueReminders.length} overdue reminder${overdueReminders.length > 1 ? 's' : ''} — take a look.`);
  if (data.openTaskCount > 5)
    tips.push(`${data.openTaskCount} open tasks piling up. Maybe prioritize the top ones?`);
  if (data.inProgressTaskCount > 0)
    tips.push(`${data.inProgressTaskCount} task${data.inProgressTaskCount > 1 ? 's' : ''} in progress — keep the momentum going.`);
  if (data.unreadReadingCount > 3)
    tips.push(`${data.unreadReadingCount} articles waiting in your reading list.`);
  if (data.unreadEmailCount > 0)
    tips.push(`${data.unreadEmailCount} email${data.unreadEmailCount > 1 ? 's' : ''} need your attention.`);
  if (tips.length === 0)
    tips.push("You're all caught up. Nice work!");

  return tips;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 30_000,
  });

  const { data: settings } = useQuery({
    queryKey: ['assistant-settings'],
    queryFn: () => api.get<any>('/chat/assistant-settings'),
    staleTime: 60_000,
  });

  const userName = settings?.user_name || '';

  if (isLoading || !data) {
    return (
      <div className="hero-loading">
        <div className="pulse-circle" />
        <p className="text-muted">Getting your day ready...</p>
      </div>
    );
  }

  const tips = getSmartSummary(data);
  const hasOverdue = data.upcomingReminders.some(r => new Date(r.dueAt) < new Date());

  return (
    <div className="dashboard">
      {/* Hero greeting */}
      <div className="hero">
        <div className="hero-text">
          <h1>{getGreeting()}{userName ? `, ${userName}` : ''}</h1>
          <p className="hero-date">{getTimeOfDay()}</p>
        </div>
      </div>

      {/* Smart nudges */}
      <div className="nudge-strip">
        {tips.map((tip, i) => (
          <div key={i} className="nudge">
            {hasOverdue && i === 0
              ? <AlertTriangle size={14} className="nudge-icon warn" />
              : <Clock size={14} className="nudge-icon" />}
            <span>{tip}</span>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="quick-actions">
        <button className="quick-action" onClick={() => navigate('/notes')}>
          <StickyNote size={18} /> New Note
        </button>
        <button className="quick-action" onClick={() => navigate('/reminders')}>
          <Bell size={18} /> Set Reminder
        </button>
        <button className="quick-action" onClick={() => navigate('/notes')}>
          <CheckSquare size={18} /> Add Task
        </button>
        <button className="quick-action" onClick={() => navigate('/reading')}>
          <BookOpen size={18} /> Save Article
        </button>
      </div>

      {/* Glance cards */}
      <div className="glance-grid">
        <div className="glance-card blue" onClick={() => navigate('/reminders')}>
          <div className="glance-top">
            <Bell size={20} />
            <span className="glance-count">{data.activeReminderCount}</span>
          </div>
          <div className="glance-label">Reminders</div>
          <div className="glance-detail">
            {data.nextReminder
              ? <>Next: {data.nextReminder.title}</>
              : 'All clear'}
          </div>
        </div>

        <div className="glance-card green" onClick={() => navigate('/notes')}>
          <div className="glance-top">
            <CheckSquare size={20} />
            <span className="glance-count">{data.openTaskCount}</span>
          </div>
          <div className="glance-label">Open Tasks</div>
          <div className="glance-detail">{data.inProgressTaskCount} in progress</div>
        </div>

        <div className="glance-card purple" onClick={() => navigate('/emails')}>
          <div className="glance-top">
            <Mail size={20} />
            <span className="glance-count">{data.unreadEmailCount}</span>
          </div>
          <div className="glance-label">Emails</div>
          <div className="glance-detail">Need attention</div>
        </div>

        <div className="glance-card amber" onClick={() => navigate('/reading')}>
          <div className="glance-top">
            <BookOpen size={20} />
            <span className="glance-count">{data.unreadReadingCount}</span>
          </div>
          <div className="glance-label">To Read</div>
          <div className="glance-detail">Articles saved</div>
        </div>
      </div>

      {/* Today's Meetings */}
      {data.todayMeetings?.length > 0 && (
        <div className="focus-section">
          <div className="focus-header">
            <h3><Calendar size={16} style={{ marginRight: 6, verticalAlign: -2 }} />Today's Meetings</h3>
            <span className="text-muted" style={{ fontSize: 12 }}>{data.todayMeetings.length} meeting{data.todayMeetings.length > 1 ? 's' : ''}</span>
          </div>
          {data.todayMeetings.map((m, i) => {
            const start = new Date(m.start);
            const end = new Date(m.end);
            const now = new Date();
            const isPast = end < now;
            const isNow = start <= now && end >= now;
            const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const duration = Math.round((end.getTime() - start.getTime()) / 60000);

            return (
              <div key={i} className={`meeting-item ${isPast ? 'past' : ''} ${isNow ? 'now' : ''}`}>
                <div className="meeting-time">
                  <span className="meeting-time-start">{timeStr}</span>
                  <span className="meeting-time-duration">{duration}m</span>
                </div>
                <div className="meeting-details">
                  <div className="meeting-title">
                    {m.joinUrl ? (
                      <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className="meeting-link">
                        {m.subject}
                        {isNow && <span className="meeting-live-badge">LIVE</span>}
                      </a>
                    ) : (
                      <span>{m.subject}{isNow && <span className="meeting-live-badge">LIVE</span>}</span>
                    )}
                  </div>
                  <div className="meeting-meta">
                    {m.location && <span><MapPin size={11} /> {m.location}</span>}
                    {m.isOnline && !m.location && <span><Video size={11} /> Online</span>}
                    {m.organizer && <span style={{ marginLeft: m.location || m.isOnline ? 8 : 0 }}>{m.organizer}</span>}
                  </div>
                </div>
                {m.joinUrl && !isPast && (
                  <a href={m.joinUrl} target="_blank" rel="noopener noreferrer"
                    className={`meeting-join-btn ${isNow ? 'live' : ''}`}
                    title={isNow ? 'Join now' : 'Join meeting'}>
                    <Video size={14} />
                    <span className="meeting-join-label">{isNow ? 'Join' : 'Join'}</span>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Today's focus sections */}
      {data.upcomingReminders.length > 0 && (
        <div className="focus-section">
          <div className="focus-header" onClick={() => navigate('/reminders')}>
            <h3>Upcoming Reminders</h3>
            <ArrowRight size={16} />
          </div>
          {data.upcomingReminders.map(r => {
            const isOverdue = new Date(r.dueAt) < new Date();
            return (
              <div key={r.id} className={`focus-item ${isOverdue ? 'overdue' : ''}`}>
                <Bell size={14} className="focus-icon" />
                <div className="focus-content">
                  <span className="focus-title">{r.title}</span>
                  <span className="focus-meta">
                    {isOverdue ? 'Overdue - ' : ''}{new Date(r.dueAt).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.recentTasks.length > 0 && (
        <div className="focus-section">
          <div className="focus-header" onClick={() => navigate('/notes')}>
            <h3>Active Tasks</h3>
            <ArrowRight size={16} />
          </div>
          {data.recentTasks.map(t => (
            <div key={t.id} className="focus-item">
              <div className={`status-dot ${statusClass[t.status]}`} />
              <div className="focus-content">
                <span className="focus-title">{t.title}</span>
                <span className={`badge ${statusClass[t.status]}`}>{statusLabel[t.status]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.recentEmails.length > 0 && (
        <div className="focus-section">
          <div className="focus-header" onClick={() => navigate('/emails')}>
            <h3>Recent Emails</h3>
            <ArrowRight size={16} />
          </div>
          {data.recentEmails.map(e => (
            <div key={e.id} className="focus-item" draggable
              onDragStart={ev => {
                ev.dataTransfer.setData('application/json', JSON.stringify({
                  type: 'email', subject: e.subject, from: e.fromName, preview: '',
                }));
                ev.dataTransfer.effectAllowed = 'copy';
              }}>
              <Mail size={14} className="focus-icon" />
              <div className="focus-content">
                <span className="focus-title">{e.subject}</span>
                <span className="focus-meta">{e.fromName}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.upcomingReminders.length === 0 && data.recentTasks.length === 0 && data.recentEmails.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">&#127793;</div>
          <h3>Your day is clear</h3>
          <p>Use the quick actions above to add notes, set reminders, or save articles.</p>
        </div>
      )}
    </div>
  );
}
