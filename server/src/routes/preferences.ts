import { Router } from 'express';
import db from '../db';
import {
  getAllPreferences, getHighConfidencePreferences, buildPreferenceProfile,
  recordSignal, recordFeedback, recordPriorityAction, recordDecision,
} from '../services/preference-engine';

const router = Router();

// Get full preference profile
router.get('/profile', (req, res) => {
  const minConfidence = parseFloat(req.query.minConfidence as string) || 0;
  const prefs = minConfidence > 0 ? getHighConfidencePreferences(minConfidence) : getAllPreferences();
  const profileText = buildPreferenceProfile();
  res.json({ preferences: prefs, profileText });
});

// Record a behavioral signal
router.post('/signal', (req, res) => {
  const { signalType, context, value, metadata } = req.body;
  if (!signalType || !value) return res.status(400).json({ error: 'signalType and value required' });
  const id = recordSignal({ signalType, context: context || '', value, metadata });
  res.json({ ok: true, id });
});

// Record feedback (positive/negative) on a response
router.post('/feedback', (req, res) => {
  const { context, positive } = req.body;
  if (context === undefined || positive === undefined) {
    return res.status(400).json({ error: 'context and positive (bool) required' });
  }
  recordFeedback(context, !!positive);
  res.json({ ok: true });
});

// Record a priority action
router.post('/priority', (req, res) => {
  const { actionType, context } = req.body;
  if (!actionType) return res.status(400).json({ error: 'actionType required' });
  recordPriorityAction(actionType, context || '');
  res.json({ ok: true });
});

// Record a decision
router.post('/decision', (req, res) => {
  const { context, decision, metadata } = req.body;
  if (!decision) return res.status(400).json({ error: 'decision required' });
  recordDecision(context || '', decision, metadata);
  res.json({ ok: true });
});

// Get recent signals (for debugging/transparency)
router.get('/signals', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const signals = db.prepare(
    'SELECT * FROM PreferenceSignals ORDER BY createdAt DESC LIMIT ?'
  ).all(limit);
  res.json(signals);
});

export default router;
