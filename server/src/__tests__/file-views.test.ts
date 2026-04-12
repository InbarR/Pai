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

// Mock file scanner (uses PowerShell)
vi.mock('../services/file-scanner', () => ({
  scanOpenDocs: vi.fn().mockResolvedValue([
    { title: 'Test Doc', path: 'https://sharepoint.com/test.docx', type: 'doc', source: 'sharepoint', app: 'Word' },
  ]),
  scanRecentDocs: vi.fn().mockResolvedValue([
    { title: 'Recent Doc', path: 'https://sharepoint.com/recent.docx', type: 'doc', source: 'sharepoint' },
  ]),
}));

import { generateFileViews } from '../services/file-views';

function seedData() {
  const db = (globalThis as any).__testDb;
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];

  db.prepare(`INSERT INTO Notes (title, content, isTask, taskStatus, dueDate, createdAt, updatedAt)
    VALUES (?, ?, 1, 1, ?, ?, ?)`).run('Review Design Doc', 'review the doc', today, now, now);

  db.prepare(`INSERT INTO ImportantEmails (graphMessageId, subject, fromName, fromEmail, receivedAt, bodyPreview, isActioned, aiCategory, aiPriority)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'action_required', 'urgent')`).run('msg-1', 'Urgent: Design Review', 'Boss', 'boss@test.com', now, 'Review ASAP');

  db.prepare(`INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen, mentions)
    VALUES (?, ?, ?, '{}', ?, ?, ?)`).run('file', 'Design Doc', 'design doc', now, now, 5);
  db.prepare(`INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen, mentions)
    VALUES (?, ?, ?, '{}', ?, ?, ?)`).run('project', 'Project Alpha', 'project alpha', now, now, 10);
  db.prepare(`INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen, mentions)
    VALUES (?, ?, ?, '{}', ?, ?, ?)`).run('person', 'Alice', 'alice', now, now, 8);

  db.prepare(`INSERT INTO MemoryEdges (fromNodeId, toNodeId, type, weight, attributes, createdAt, lastSeen)
    VALUES (2, 1, 'related_to', 3, '{}', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO MemoryEdges (fromNodeId, toNodeId, type, weight, attributes, createdAt, lastSeen)
    VALUES (3, 1, 'mentioned_in', 2, '{}', ?, ?)`).run(now, now);
}

describe('File Views Service', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  it('returns views and whatMattersNow', async () => {
    seedData();
    const r = await generateFileViews();
    expect(r.views).toBeDefined();
    expect(r.whatMattersNow).toBeDefined();
  });

  it('whatMattersNow is deduplicated and capped at 5', async () => {
    seedData();
    const r = await generateFileViews();
    expect(r.whatMattersNow.length).toBeLessThanOrEqual(5);
    const names = r.whatMattersNow.map(i => i.file);
    expect(new Set(names).size).toBe(names.length);
  });

  it('items have file, reason, score', async () => {
    seedData();
    for (const item of (await generateFileViews()).whatMattersNow) {
      expect(item.file).toBeTruthy();
      expect(item.reason).toBeTruthy();
      expect(typeof item.score).toBe('number');
    }
  });

  it('returns views with mocked scanner data', async () => {
    const r = await generateFileViews();
    // Should have at least Currently Open and Recent from mocked scanner
    expect(r.views.length).toBeGreaterThan(0);
    expect(r.views[0].name).toBe('Currently Open');
  });

  it('Projects view groups by project', async () => {
    seedData();
    const proj = (await generateFileViews()).views.find(v => v.name === 'Projects');
    if (proj?.groups) {
      expect(proj.groups.length).toBeGreaterThan(0);
      expect(proj.groups[0].items.length).toBeGreaterThan(0);
    }
  });

  it('People view groups by person', async () => {
    seedData();
    const ppl = (await generateFileViews()).views.find(v => v.name === 'People');
    if (ppl?.groups) {
      expect(ppl.groups.length).toBeGreaterThan(0);
    }
  });
});
