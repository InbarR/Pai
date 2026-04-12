import db from '../db';

// --- Types ---

export interface UserPreference {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidenceCount: number;
  lastEvidence: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceSignal {
  signalType: string;
  context: string;
  value: string;
  metadata?: Record<string, any>;
}

// Minimum signals required before a preference reaches high confidence
const MIN_SIGNALS_FOR_CONFIDENCE = 3;
const CONFIDENCE_PER_SIGNAL = 0.2; // each signal adds 0.2, capped at 1.0

// --- Record a signal ---

export function recordSignal(signal: PreferenceSignal): number {
  const result = db.prepare(
    'INSERT INTO PreferenceSignals (signalType, context, value, metadata) VALUES (?, ?, ?, ?)'
  ).run(signal.signalType, signal.context, signal.value, JSON.stringify(signal.metadata || {}));

  // After recording, analyze recent signals of this type
  analyzeSignals(signal.signalType);

  return result.lastInsertRowid as number;
}

// --- Analyze signals and update preferences ---

function analyzeSignals(signalType: string) {
  switch (signalType) {
    case 'response_tone':
      inferTonePreference();
      break;
    case 'response_length':
      inferLengthPreference();
      break;
    case 'response_feedback':
      inferFeedbackPreferences();
      break;
    case 'priority_action':
      inferPriorityPatterns();
      break;
    case 'decision':
      inferDecisionPatterns();
      break;
    default:
      // Generic: just store the signal, preference inference happens periodically
      break;
  }
}

function inferTonePreference() {
  // Count tone signals from recent interactions
  const signals = db.prepare(
    "SELECT value, COUNT(*) as count FROM PreferenceSignals WHERE signalType = 'response_tone' GROUP BY value ORDER BY count DESC"
  ).all() as any[];

  if (signals.length === 0) return;

  const total = signals.reduce((sum: number, s: any) => sum + s.count, 0);
  const top = signals[0];

  if (total >= MIN_SIGNALS_FOR_CONFIDENCE) {
    const confidence = Math.min(1.0, (top.count / total) * (total * CONFIDENCE_PER_SIGNAL));
    upsertPreference('tone', 'preferred_tone', top.value, confidence, `${top.count}/${total} interactions`);
  }
}

function inferLengthPreference() {
  const signals = db.prepare(
    "SELECT value FROM PreferenceSignals WHERE signalType = 'response_length' ORDER BY createdAt DESC LIMIT 20"
  ).all() as any[];

  if (signals.length < MIN_SIGNALS_FOR_CONFIDENCE) return;

  // Classify: short (<100 words), medium (100-300), long (300+)
  const lengths = signals.map(s => parseInt(s.value) || 0);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  let pref = 'medium';
  if (avg < 100) pref = 'concise';
  else if (avg > 300) pref = 'detailed';

  const confidence = Math.min(1.0, signals.length * CONFIDENCE_PER_SIGNAL);
  upsertPreference('style', 'preferred_length', pref, confidence, `avg ${Math.round(avg)} words over ${signals.length} responses`);
}

function inferFeedbackPreferences() {
  // Look at positive/negative feedback signals
  const positive = db.prepare(
    "SELECT context, value FROM PreferenceSignals WHERE signalType = 'response_feedback' AND value = 'positive' ORDER BY createdAt DESC LIMIT 10"
  ).all() as any[];

  const negative = db.prepare(
    "SELECT context, value FROM PreferenceSignals WHERE signalType = 'response_feedback' AND value = 'negative' ORDER BY createdAt DESC LIMIT 10"
  ).all() as any[];

  if (positive.length >= MIN_SIGNALS_FOR_CONFIDENCE) {
    // Extract common patterns from positive contexts
    const confidence = Math.min(1.0, positive.length * CONFIDENCE_PER_SIGNAL);
    upsertPreference('style', 'positive_patterns', JSON.stringify(positive.map(p => p.context).slice(0, 5)),
      confidence, `${positive.length} positive signals`);
  }

  if (negative.length >= MIN_SIGNALS_FOR_CONFIDENCE) {
    const confidence = Math.min(1.0, negative.length * CONFIDENCE_PER_SIGNAL);
    upsertPreference('style', 'negative_patterns', JSON.stringify(negative.map(n => n.context).slice(0, 5)),
      confidence, `${negative.length} negative signals`);
  }
}

function inferPriorityPatterns() {
  // What does the user tend to act on first?
  const signals = db.prepare(
    "SELECT value, COUNT(*) as count FROM PreferenceSignals WHERE signalType = 'priority_action' GROUP BY value ORDER BY count DESC LIMIT 5"
  ).all() as any[];

  if (signals.length === 0) return;

  const total = signals.reduce((sum: number, s: any) => sum + s.count, 0);
  if (total >= MIN_SIGNALS_FOR_CONFIDENCE) {
    const priorities = signals.map((s: any) => `${s.value} (${s.count}x)`).join(', ');
    const confidence = Math.min(1.0, total * CONFIDENCE_PER_SIGNAL);
    upsertPreference('priorities', 'action_priorities', priorities, confidence, `${total} actions observed`);
  }
}

function inferDecisionPatterns() {
  const signals = db.prepare(
    "SELECT context, value, metadata FROM PreferenceSignals WHERE signalType = 'decision' ORDER BY createdAt DESC LIMIT 20"
  ).all() as any[];

  if (signals.length < MIN_SIGNALS_FOR_CONFIDENCE) return;

  const confidence = Math.min(1.0, signals.length * CONFIDENCE_PER_SIGNAL);
  const patterns = signals.slice(0, 5).map((s: any) => `${s.context}: ${s.value}`);
  upsertPreference('decisions', 'recent_patterns', JSON.stringify(patterns),
    confidence, `${signals.length} decisions tracked`);
}

// --- Preference CRUD ---

function upsertPreference(category: string, key: string, value: string, confidence: number, evidence: string) {
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id, evidenceCount FROM UserPreferences WHERE category = ? AND key = ?'
  ).get(category, key) as any;

  if (existing) {
    db.prepare(
      'UPDATE UserPreferences SET value = ?, confidence = ?, evidenceCount = evidenceCount + 1, lastEvidence = ?, updatedAt = ? WHERE id = ?'
    ).run(value, confidence, evidence, now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO UserPreferences (category, key, value, confidence, evidenceCount, lastEvidence, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
    ).run(category, key, value, confidence, evidence, now, now);
  }
}

export function getPreference(category: string, key: string): UserPreference | null {
  return db.prepare(
    'SELECT * FROM UserPreferences WHERE category = ? AND key = ?'
  ).get(category, key) as UserPreference | null;
}

export function getAllPreferences(): UserPreference[] {
  return db.prepare('SELECT * FROM UserPreferences ORDER BY category, key').all() as UserPreference[];
}

export function getHighConfidencePreferences(minConfidence = 0.5): UserPreference[] {
  return db.prepare(
    'SELECT * FROM UserPreferences WHERE confidence >= ? ORDER BY confidence DESC'
  ).all(minConfidence) as UserPreference[];
}

// --- Build preference profile for chat system prompt ---

export function buildPreferenceProfile(): string {
  const prefs = getHighConfidencePreferences(0.4);
  if (prefs.length === 0) return '';

  const lines: string[] = ['User preference profile (learned from behavior):'];

  const grouped: Record<string, UserPreference[]> = {};
  for (const p of prefs) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`  ${category}:`);
    for (const item of items) {
      const conf = item.confidence >= 0.7 ? 'strong' : 'moderate';
      lines.push(`    - ${item.key}: ${item.value} (${conf} signal, ${item.evidenceCount} observations)`);
    }
  }

  lines.push('Apply these preferences when generating responses. If a preference seems wrong, mention it transparently.');
  return lines.join('\n');
}

// --- Record chat interaction signals ---

export function recordChatSignal(userMessage: string, assistantResponse: string, metadata?: Record<string, any>) {
  // Record response length preference
  const wordCount = assistantResponse.split(/\s+/).length;
  recordSignal({
    signalType: 'response_length',
    context: userMessage.substring(0, 100),
    value: wordCount.toString(),
    metadata,
  });
}

export function recordFeedback(context: string, isPositive: boolean) {
  recordSignal({
    signalType: 'response_feedback',
    context: context.substring(0, 200),
    value: isPositive ? 'positive' : 'negative',
  });
}

export function recordPriorityAction(actionType: string, context: string) {
  recordSignal({
    signalType: 'priority_action',
    context: context.substring(0, 200),
    value: actionType,
  });
}

export function recordDecision(context: string, decision: string, metadata?: Record<string, any>) {
  recordSignal({
    signalType: 'decision',
    context: context.substring(0, 200),
    value: decision,
    metadata,
  });
}
