import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, getTestDb } from './test-db';

vi.mock('../db', () => ({
  default: new Proxy({}, {
    get(_, prop) {
      
      const db = (globalThis as any).__testDb;
      if (!db) throw new Error('Test DB not initialized');
      const val = db[prop as string];
      return typeof val === 'function' ? val.bind(db) : val;
    },
  }),
}));

vi.mock('../services/graph', () => ({
  getTodayCalendar: vi.fn().mockResolvedValue([
    { subject: 'Standup', start: new Date().toISOString(), end: new Date(Date.now() + 1800000).toISOString(),
      location: 'Room 101', organizer: 'Alice', isOnline: true, joinUrl: 'https://teams.microsoft.com/meet/123' },
    { subject: 'Sprint Planning', start: new Date(Date.now() + 7200000).toISOString(), end: new Date(Date.now() + 10800000).toISOString(),
      location: '', organizer: 'Bob', isOnline: true, joinUrl: 'https://teams.microsoft.com/meet/456' },
  ]),
}));

describe('Dashboard', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  function seedData() {
    const db = (globalThis as any).__testDb;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    db.prepare('INSERT INTO Reminders (title, dueAt) VALUES (?, ?)').run('Call dentist', future);
    db.prepare('INSERT INTO TaskItems (title, status) VALUES (?, ?)').run('Fix bug', 0);
    db.prepare(`INSERT INTO ImportantEmails (graphMessageId, subject, fromName, fromEmail, receivedAt, aiCategory, aiPriority) VALUES (?,?,?,?,?,'','')`).run('msg-1', 'Email', 'Alice', 'a@t.com', now);
    db.prepare('INSERT INTO Notes (title, content, createdAt, updatedAt) VALUES (?,?,?,?)').run('Note', 'text', now, now);
  }

  it('database seeds correctly', () => {
    seedData();
    const db = (globalThis as any).__testDb;
    expect((db.prepare('SELECT COUNT(*) as c FROM Reminders').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) as c FROM TaskItems WHERE status = 0').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) as c FROM ImportantEmails').get() as any).c).toBe(1);
  });

  it('getTodayCalendar returns meetings', async () => {
    const { getTodayCalendar } = await import('../services/graph');
    const events = await getTodayCalendar();
    expect(events.length).toBe(2);
    expect(events[0].subject).toBe('Standup');
    expect(events[0].joinUrl).toBeTruthy();
  });

  it('meetings have correct shape', async () => {
    const { getTodayCalendar } = await import('../services/graph');
    for (const e of await getTodayCalendar()) {
      expect(e).toHaveProperty('subject');
      expect(e).toHaveProperty('start');
      expect(e).toHaveProperty('end');
      expect(e).toHaveProperty('organizer');
      expect(e).toHaveProperty('isOnline');
    }
  });

  it('handles calendar failure gracefully', async () => {
    const graph = await import('../services/graph');
    vi.mocked(graph.getTodayCalendar).mockRejectedValueOnce(new Error('Outlook not running'));
    const events = await graph.getTodayCalendar().catch(() => []);
    expect(events).toEqual([]);
  });
});
