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

import { getAttentionItems, groupByThread, getDailySummary } from '../services/email-triage';

function seedEmails() {
  const db = (globalThis as any).__testDb;
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const pastDate = new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0];
  const ins = db.prepare(`INSERT INTO ImportantEmails (graphMessageId, subject, fromName, fromEmail, receivedAt, bodyPreview, isActioned,
    aiCategory, aiPriority, aiSummary, aiSuggestedAction, aiActionItems, aiDeadlines, aiThreadTopic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  ins.run('msg-1', 'Budget approval needed', 'Alice', 'alice@test.com', now.toISOString(), 'Please approve by Friday', 0,
    'action_required', 'urgent', 'Budget needs approval', 'Reply', '["Approve the Q3 budget"]', `["${today}"]`, 'Budget Review');
  ins.run('msg-2', 'Q3 results published', 'Bob', 'bob@test.com', now.toISOString(), 'See attached', 0,
    'fyi', 'high', 'Q3 results are out', 'Read', '[]', '[]', 'Q3 Results');
  ins.run('msg-3', 'Review PR #42', 'Charlie', 'charlie@test.com', now.toISOString(), 'Please review', 0,
    'action_required', 'normal', 'PR review', 'Reply', '["Review PR #42"]', '[]', 'Code Review');
  ins.run('msg-4', 'Weekly digest', 'News', 'news@test.com', now.toISOString(), 'Tech news', 0,
    'newsletter', 'low', 'Roundup', 'Archive', '[]', '[]', '');
  ins.run('msg-5', 'Old thread', 'Dave', 'dave@test.com', now.toISOString(), 'Done', 1,
    'action_required', 'urgent', 'Old', 'Done', '[]', '[]', 'Old Thread');
  ins.run('msg-6', 'Overdue report', 'Eve', 'eve@test.com', now.toISOString(), 'Was due last week', 0,
    'action_required', 'high', 'Report overdue', 'Follow up', '["Submit report"]', `["${pastDate}"]`, 'Reports');
}

describe('Email Triage Service', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  describe('getAttentionItems', () => {
    it('returns prioritized items, urgent first', () => {
      seedEmails();
      const items = getAttentionItems();
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].priority).toBe('urgent');
    });

    it('excludes newsletters and actioned emails', () => {
      seedEmails();
      const items = getAttentionItems();
      expect(items.find(i => i.subject === 'Weekly digest')).toBeUndefined();
      expect(items.find(i => i.subject === 'Old thread')).toBeUndefined();
    });

    it('includes action items and deadlines', () => {
      seedEmails();
      const item = getAttentionItems().find(i => i.subject === 'Budget approval needed');
      expect(item!.actionItems.length).toBe(1);
      expect(item!.deadlines.length).toBe(1);
    });

    it('respects limit', () => {
      seedEmails();
      expect(getAttentionItems(2).length).toBeLessThanOrEqual(2);
    });
  });

  describe('groupByThread', () => {
    it('groups by thread topic', () => {
      seedEmails();
      const groups = groupByThread();
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.topic).toBeTruthy();
        expect(g.emails.length).toBeGreaterThan(0);
      }
    });

    it('flags action-required threads', () => {
      seedEmails();
      const budget = groupByThread().find(g => g.topic === 'Budget Review');
      expect(budget?.hasActionRequired).toBe(true);
    });
  });

  describe('getDailySummary', () => {
    it('returns complete summary', () => {
      seedEmails();
      const s = getDailySummary();
      expect(s.date).toBeTruthy();
      expect(s.stats.total).toBeGreaterThan(0);
      expect(s.urgent.length).toBeGreaterThan(0);
      expect(s.actionRequired.length).toBeGreaterThan(0);
    });

    it('detects today deadlines', () => {
      seedEmails();
      const s = getDailySummary();
      expect(s.deadlinesToday.length).toBeGreaterThan(0);
    });

    it('flags overdue commitments', () => {
      seedEmails();
      const s = getDailySummary();
      expect(s.overdueCommitments.length).toBeGreaterThan(0);
      expect(s.overdueCommitments[0].daysPast).toBeGreaterThan(0);
    });

    it('includes top threads', () => {
      seedEmails();
      expect(getDailySummary().topThreads.length).toBeGreaterThan(0);
    });
  });
});
