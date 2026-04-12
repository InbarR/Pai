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

import {
  recordSignal, getAllPreferences, getHighConfidencePreferences,
  buildPreferenceProfile, recordChatSignal, recordFeedback,
  recordPriorityAction, recordDecision,
} from '../services/preference-engine';

describe('Preference Engine', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  describe('recordSignal', () => {
    it('stores a signal in the database', () => {
      const id = recordSignal({ signalType: 'response_length', context: 'test', value: '150' });
      expect(id).toBeGreaterThan(0);
      const signal = getTestDb().prepare('SELECT * FROM PreferenceSignals WHERE id = ?').get(id) as any;
      expect(signal.signalType).toBe('response_length');
    });

    it('stores metadata as JSON', () => {
      const id = recordSignal({ signalType: 'decision', context: 'email', value: 'archive', metadata: { emailId: 42 } });
      const signal = getTestDb().prepare('SELECT * FROM PreferenceSignals WHERE id = ?').get(id) as any;
      expect(JSON.parse(signal.metadata).emailId).toBe(42);
    });
  });

  describe('preference inference', () => {
    it('does not infer below minimum signals', () => {
      recordSignal({ signalType: 'response_length', context: '', value: '50' });
      recordSignal({ signalType: 'response_length', context: '', value: '60' });
      expect(getAllPreferences().find(p => p.key === 'preferred_length')).toBeUndefined();
    });

    it('infers concise length after enough signals', () => {
      for (let i = 0; i < 4; i++) recordSignal({ signalType: 'response_length', context: '', value: '50' });
      const pref = getAllPreferences().find(p => p.key === 'preferred_length');
      expect(pref).toBeTruthy();
      expect(pref!.value).toBe('concise');
    });

    it('infers detailed length for long responses', () => {
      for (let i = 0; i < 4; i++) recordSignal({ signalType: 'response_length', context: '', value: '400' });
      expect(getAllPreferences().find(p => p.key === 'preferred_length')!.value).toBe('detailed');
    });
  });

  describe('feedback', () => {
    it('tracks positive feedback patterns', () => {
      for (let i = 0; i < 4; i++) recordFeedback(`answer ${i}`, true);
      expect(getAllPreferences().find(p => p.key === 'positive_patterns')).toBeTruthy();
    });

    it('tracks negative feedback patterns', () => {
      for (let i = 0; i < 4; i++) recordFeedback(`verbose ${i}`, false);
      expect(getAllPreferences().find(p => p.key === 'negative_patterns')).toBeTruthy();
    });
  });

  describe('priority & decisions', () => {
    it('tracks priority patterns', () => {
      for (let i = 0; i < 4; i++) recordPriorityAction('email', 'inbox');
      const pref = getAllPreferences().find(p => p.key === 'action_priorities');
      expect(pref).toBeTruthy();
      expect(pref!.value).toContain('email');
    });

    it('tracks decision patterns', () => {
      for (let i = 0; i < 4; i++) recordDecision('triage', 'archive');
      expect(getAllPreferences().find(p => p.key === 'recent_patterns')).toBeTruthy();
    });
  });

  describe('buildPreferenceProfile', () => {
    it('returns empty string when no preferences', () => {
      expect(buildPreferenceProfile()).toBe('');
    });

    it('builds profile string from preferences', () => {
      for (let i = 0; i < 5; i++) recordSignal({ signalType: 'response_length', context: '', value: '50' });
      const profile = buildPreferenceProfile();
      expect(profile).toContain('preference');
      expect(profile).toContain('concise');
    });
  });

  describe('recordChatSignal', () => {
    it('records response length', () => {
      recordChatSignal('question', 'a short answer');
      const signal = getTestDb().prepare("SELECT * FROM PreferenceSignals WHERE signalType = 'response_length'").get() as any;
      expect(signal).toBeTruthy();
    });
  });

  describe('getHighConfidencePreferences', () => {
    it('filters by minimum confidence', () => {
      for (let i = 0; i < 5; i++) recordSignal({ signalType: 'response_length', context: '', value: '50' });
      const high = getHighConfidencePreferences(0.5);
      const all = getHighConfidencePreferences(0.0);
      expect(all.length).toBeGreaterThanOrEqual(high.length);
    });
  });
});
