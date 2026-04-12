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

import { getFileConnections } from '../services/file-connections';

function seedData() {
  const db = (globalThis as any).__testDb;
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO ImportantEmails (graphMessageId, subject, fromName, fromEmail, receivedAt, bodyPreview, aiCategory, aiPriority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('msg-1', 'Budget Report Q3', 'Alice', 'alice@test.com', now, 'attached budget', 'fyi', 'normal');
  db.prepare(`INSERT INTO ImportantEmails (graphMessageId, subject, fromName, fromEmail, receivedAt, bodyPreview, aiCategory, aiPriority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('msg-2', 'Budget Report Review', 'Bob', 'bob@test.com', now, 'reviewed budget', 'action_required', 'high');

  db.prepare(`INSERT INTO Notes (title, content, isTask, taskStatus, createdAt, updatedAt)
    VALUES (?, ?, 1, 1, ?, ?)`).run('Finalize Budget Report', 'Q3 budget report', now, now);

  db.prepare(`INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen, mentions)
    VALUES (?, ?, ?, '{}', ?, ?, 3)`).run('file', 'Budget Report', 'budget report', now, now);
  db.prepare(`INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen, mentions)
    VALUES (?, ?, ?, '{}', ?, ?, 5)`).run('person', 'Alice', 'alice', now, now);
  db.prepare(`INSERT INTO MemoryEdges (fromNodeId, toNodeId, type, weight, attributes, createdAt, lastSeen)
    VALUES (2, 1, 'mentioned_in', 2, '{}', ?, ?)`).run(now, now);
}

describe('File Connections Service', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('returns structured result', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    expect(r.file).toBe('Budget Report');
    expect(r.connections.people).toBeDefined();
    expect(r.connections.emails).toBeDefined();
    expect(r.connections.tasks).toBeDefined();
  });

  it('finds related emails', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    expect(r.connections.emails.length).toBeGreaterThan(0);
  });

  it('finds related tasks', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    expect(r.connections.tasks.length).toBeGreaterThan(0);
  });

  it('finds people from memory graph', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    expect(r.connections.people.length).toBeGreaterThan(0);
  });

  it('builds summary', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    expect(r.summary).not.toBe('No connections found yet');
  });

  it('topConnections sorted by confidence', () => {
    seedData();
    const r = getFileConnections('Budget Report');
    for (let i = 1; i < r.topConnections.length; i++) {
      expect(r.topConnections[i - 1].confidence).toBeGreaterThanOrEqual(r.topConnections[i].confidence);
    }
  });

  it('returns empty for unknown file', () => {
    const r = getFileConnections('Nonexistent12345');
    expect(r.summary).toBe('No connections found yet');
    expect(r.topConnections.length).toBe(0);
  });
});
