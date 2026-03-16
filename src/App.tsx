import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './components/dashboard/DashboardPage';
import NotesPage from './components/notes/NotesPage';
import RemindersPage from './components/reminders/RemindersPage';
import ReadingPage from './components/reading/ReadingPage';
import EmailsPage from './components/emails/EmailsPage';
import FilesPage from './components/files/FilesPage';
import PeoplePage from './components/people/PeoplePage';
import SettingsPage from './components/settings/SettingsPage';
import PaiMascot from './components/chat/PaiMascot';
import { useNotifications } from './hooks/useNotifications';
import { X, Clock, CheckCircle2, MessageCircle } from 'lucide-react';
import { api } from './api/client';
import { useState, useEffect } from 'react';
import CommandPalette from './components/CommandPalette';

function parseSnoozeInput(input: string): number {
  const s = input.toLowerCase().trim();
  // "tomorrow 9am" or "tomorrow 10:30"
  if (s.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = parseInt(timeMatch[2] || '0');
      if (timeMatch[3] === 'pm' && h < 12) h += 12;
      if (timeMatch[3] === 'am' && h === 12) h = 0;
      tomorrow.setHours(h, m, 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0);
    }
    return Math.max(1, Math.round((tomorrow.getTime() - Date.now()) / 60000));
  }
  // "30m", "30 min", "30 minutes"
  const minMatch = s.match(/^(\d+)\s*m/);
  if (minMatch) return parseInt(minMatch[1]);
  // "2h", "2 hours"
  const hourMatch = s.match(/^(\d+)\s*h/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60;
  // "1d", "1 day"
  const dayMatch = s.match(/^(\d+)\s*d/);
  if (dayMatch) return parseInt(dayMatch[1]) * 1440;
  // Plain number = minutes
  const num = parseInt(s);
  if (!isNaN(num)) return num;
  return 15; // fallback
}

export default function App() {
  const { bubble, dismissBubble } = useNotifications();

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+P — command palette
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
      // Ctrl+F — focus search input on current page
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.querySelector('.notes-search input, .emails-list-header input, .quick-add-input') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);
  const [snoozeInput, setSnoozeInput] = useState('');

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/reading" element={<ReadingPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>

      {/* Pai companion window — small floating bubble with chat input */}
      {bubble && (
        <div className="pai-companion">
          <div className="pai-companion-header">
            <PaiMascot size={32} />
            <div className="pai-companion-msg">
              <span className="pai-bubble-name">Pai</span>
              <span className="pai-companion-text">
                {bubble.message.split('**').map((part, i) =>
                  i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                )}
              </span>
              {bubble.detail && <span className="pai-bubble-detail">{bubble.detail}</span>}
            </div>
            <button className="ghost" onClick={() => { dismissBubble(); setShowSnoozeOptions(false); }}>
              <X size={14} />
            </button>
          </div>
          <div className="pai-companion-actions">
            {bubble.joinUrl && (
              <button className="join-btn" onClick={() => { window.open(bubble.joinUrl, '_blank'); }}>
                Join Meeting
              </button>
            )}
            {bubble.reminderId && (
              <button onClick={() => setShowSnoozeOptions(!showSnoozeOptions)}>
                <Clock size={12} /> Snooze
              </button>
            )}
            <button onClick={() => {
              if (bubble.reminderId) api.post(`/reminders/${bubble.reminderId}/dismiss`);
              dismissBubble(); setShowSnoozeOptions(false);
            }}>
              <CheckCircle2 size={12} /> {bubble.reminderId ? 'Done' : 'Dismiss'}
            </button>
          </div>
          {bubble.links && bubble.links.length > 0 && (
            <div className="pai-companion-links">
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Links from agenda</span>
              {bubble.links.map((url, i) => {
                const label = (() => {
                  try { const u = new URL(url); return u.hostname + (u.pathname.length > 1 ? u.pathname.substring(0, 30) : ''); } catch { return url.substring(0, 40); }
                })();
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="meeting-link">
                    {label}
                  </a>
                );
              })}
            </div>
          )}
          {showSnoozeOptions && (
            <div className="pai-companion-snooze">
              <input
                placeholder="e.g. 30m, 2h, tomorrow 9am"
                value={snoozeInput}
                onChange={e => setSnoozeInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && snoozeInput.trim() && bubble.reminderId) {
                    const mins = parseSnoozeInput(snoozeInput.trim());
                    if (mins > 0) api.post(`/reminders/${bubble.reminderId}/snooze`, { minutes: mins });
                    dismissBubble(); setShowSnoozeOptions(false); setSnoozeInput('');
                  }
                }}
                autoFocus
              />
              <div className="pai-snooze-presets">
                {['15m', '30m', '1h', '2h', 'tomorrow'].map(label => (
                  <button key={label} onClick={() => {
                    if (bubble.reminderId) {
                      const mins = parseSnoozeInput(label);
                      if (mins > 0) api.post(`/reminders/${bubble.reminderId}/snooze`, { minutes: mins });
                    }
                    dismissBubble(); setShowSnoozeOptions(false); setSnoozeInput('');
                  }}>{label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="pai-companion-footer">
            <button onClick={() => { dismissBubble(); setShowSnoozeOptions(false); window.dispatchEvent(new Event('pai-show-chat')); }}>
              <MessageCircle size={12} /> Open Pai
            </button>
          </div>
        </div>
      )}
    </>
  );
}
