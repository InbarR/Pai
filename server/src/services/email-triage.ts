import db from '../db';

// --- Types ---

export interface AttentionItem {
  emailId: number;
  subject: string;
  from: string;
  receivedAt: string;
  priority: string;
  category: string;
  whyItMatters: string;
  requiredAction: string;
  suggestedResponse?: string;
  actionItems: string[];
  deadlines: string[];
  threadTopic: string;
}

export interface ThreadGroup {
  topic: string;
  emails: {
    id: number;
    subject: string;
    from: string;
    receivedAt: string;
    priority: string;
    summary: string;
  }[];
  latestActivity: string;
  hasActionRequired: boolean;
}

export interface DailySummary {
  date: string;
  urgent: AttentionItem[];
  actionRequired: AttentionItem[];
  deadlinesToday: { emailId: number; subject: string; deadline: string }[];
  overdueCommitments: { emailId: number; subject: string; deadline: string; daysPast: number }[];
  topThreads: ThreadGroup[];
  stats: { total: number; unread: number; actionRequired: number; urgent: number };
}

// --- Get items that need attention (prioritized) ---

export function getAttentionItems(limit = 20): AttentionItem[] {
  const rows = db.prepare(`
    SELECT id, subject, fromName, fromEmail, receivedAt, aiCategory, aiPriority,
           aiSummary, aiSuggestedAction, aiActionItems, aiDeadlines, aiThreadTopic, isActioned
    FROM ImportantEmails
    WHERE isActioned = 0 AND aiCategory IN ('action_required', 'fyi')
    AND aiPriority IN ('urgent', 'high', 'normal')
    ORDER BY
      CASE aiPriority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      receivedAt DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(r => ({
    emailId: r.id,
    subject: r.subject,
    from: r.fromName || r.fromEmail,
    receivedAt: r.receivedAt,
    priority: r.aiPriority || 'normal',
    category: r.aiCategory || 'fyi',
    whyItMatters: buildWhyItMatters(r),
    requiredAction: r.aiSuggestedAction || 'Review',
    actionItems: safeParseArray(r.aiActionItems),
    deadlines: safeParseArray(r.aiDeadlines),
    threadTopic: r.aiThreadTopic || '',
  }));
}

function buildWhyItMatters(email: any): string {
  const parts: string[] = [];
  if (email.aiPriority === 'urgent') parts.push('Urgent');
  if (email.aiCategory === 'action_required') parts.push('requires your action');
  const deadlines = safeParseArray(email.aiDeadlines);
  if (deadlines.length > 0) parts.push(`deadline: ${deadlines[0]}`);
  const actions = safeParseArray(email.aiActionItems);
  if (actions.length > 0) parts.push(`${actions.length} action item(s)`);
  if (parts.length === 0) parts.push(email.aiSummary || 'May need your attention');
  return parts.join(' — ');
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// --- Group emails by thread/topic ---

export function groupByThread(): ThreadGroup[] {
  const rows = db.prepare(`
    SELECT id, subject, fromName, receivedAt, aiPriority, aiCategory, aiSummary, aiThreadTopic
    FROM ImportantEmails
    WHERE isActioned = 0
    ORDER BY receivedAt DESC
    LIMIT 100
  `).all() as any[];

  const groups = new Map<string, ThreadGroup>();

  for (const r of rows) {
    const topic = r.aiThreadTopic || inferTopic(r.subject);
    if (!topic) continue;

    if (!groups.has(topic)) {
      groups.set(topic, {
        topic,
        emails: [],
        latestActivity: r.receivedAt,
        hasActionRequired: false,
      });
    }

    const group = groups.get(topic)!;
    group.emails.push({
      id: r.id,
      subject: r.subject,
      from: r.fromName,
      receivedAt: r.receivedAt,
      priority: r.aiPriority,
      summary: r.aiSummary,
    });
    if (r.aiCategory === 'action_required') group.hasActionRequired = true;
    if (r.receivedAt > group.latestActivity) group.latestActivity = r.receivedAt;
  }

  // Sort: action-required threads first, then by latest activity
  return Array.from(groups.values())
    .sort((a, b) => {
      if (a.hasActionRequired !== b.hasActionRequired) return a.hasActionRequired ? -1 : 1;
      return b.latestActivity.localeCompare(a.latestActivity);
    })
    .slice(0, 20);
}

function inferTopic(subject: string): string {
  // Strip common prefixes
  let clean = subject
    .replace(/^(re|fw|fwd|fyi):\s*/gi, '')
    .replace(/^(re|fw|fwd|fyi):\s*/gi, '') // double strip for "Re: Fwd:"
    .trim();
  // Normalize for grouping
  return clean.substring(0, 80);
}

// --- Daily summary ---

export function getDailySummary(): DailySummary {
  const today = new Date().toISOString().split('T')[0];

  const urgent = getAttentionItems(50).filter(i => i.priority === 'urgent');
  const actionRequired = getAttentionItems(50).filter(i => i.category === 'action_required');

  // Find deadlines that are today
  const allEmails = db.prepare(
    "SELECT id, subject, aiDeadlines FROM ImportantEmails WHERE isActioned = 0 AND aiDeadlines != '[]'"
  ).all() as any[];

  const deadlinesToday: { emailId: number; subject: string; deadline: string }[] = [];
  const overdueCommitments: { emailId: number; subject: string; deadline: string; daysPast: number }[] = [];

  for (const e of allEmails) {
    const deadlines = safeParseArray(e.aiDeadlines);
    for (const d of deadlines) {
      // Try to parse the deadline as a date
      const deadlineDate = new Date(d);
      if (isNaN(deadlineDate.getTime())) continue;

      const deadlineStr = deadlineDate.toISOString().split('T')[0];
      if (deadlineStr === today) {
        deadlinesToday.push({ emailId: e.id, subject: e.subject, deadline: d });
      } else if (deadlineStr < today) {
        const daysPast = Math.floor((Date.now() - deadlineDate.getTime()) / 86400000);
        overdueCommitments.push({ emailId: e.id, subject: e.subject, deadline: d, daysPast });
      }
    }
  }

  const topThreads = groupByThread().slice(0, 5);

  const stats = {
    total: (db.prepare('SELECT COUNT(*) as c FROM ImportantEmails WHERE isActioned = 0').get() as any).c,
    unread: (db.prepare('SELECT COUNT(*) as c FROM ImportantEmails WHERE isActioned = 0 AND isRead = 0').get() as any).c,
    actionRequired: actionRequired.length,
    urgent: urgent.length,
  };

  return {
    date: today,
    urgent: urgent.slice(0, 5),
    actionRequired: actionRequired.slice(0, 10),
    deadlinesToday,
    overdueCommitments: overdueCommitments.sort((a, b) => b.daysPast - a.daysPast),
    topThreads,
    stats,
  };
}
