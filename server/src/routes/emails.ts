import { Router } from 'express';
import db from '../db';
import { syncEmails, getAuthStatus, getEmailBody, getEmailFolders, getFolderEmails } from '../services/graph';
import { chatCompletion, isAuthenticated as isCopilotAuth } from '../services/copilot';
import { extractAndIngest } from '../services/entity-extractor';
import { getAttentionItems, groupByThread, getDailySummary } from '../services/email-triage';

const router = Router();

router.get('/', (req, res) => {
  const emails = db.prepare(
    'SELECT * FROM ImportantEmails ORDER BY receivedAt DESC LIMIT 50'
  ).all();
  res.json(emails);
});

// Get folder tree
router.get('/folders', async (req, res) => {
  try {
    const tree = await getEmailFolders();
    res.json(tree);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get emails from a specific folder
router.get('/folder/:path(*)', async (req, res) => {
  try {
    const count = parseInt(req.query.count as string) || 30;
    const emails = await getFolderEmails((req.params as any).path || req.params[0], count);
    res.json(emails);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      return res.status(401).json({ error: 'Not authenticated with Outlook' });
    }
    const count = await syncEmails();

    // Trigger AI triage in background for unprocessed emails
    triageNewEmails().catch(err => console.error('[Triage]', err.message));

    // Extract entities into memory graph in background
    ingestNewEmails().catch(err => console.error('[MemoryGraph]', err.message));

    res.json({ synced: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get full email body by entry ID (from local DB graphMessageId)
router.get('/:id/body', async (req, res) => {
  try {
    const email: any = db.prepare('SELECT graphMessageId FROM ImportantEmails WHERE id = ?').get(req.params.id);
    if (!email) return res.status(404).json({ error: 'Not found' });
    const body = await getEmailBody(email.graphMessageId);
    res.json(body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger AI triage
router.post('/triage', async (req, res) => {
  try {
    const count = await triageNewEmails();
    res.json({ triaged: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/toggle-actioned', (req, res) => {
  db.prepare('UPDATE ImportantEmails SET isActioned = CASE WHEN isActioned = 0 THEN 1 ELSE 0 END WHERE id = ?')
    .run(req.params.id);
  res.json(db.prepare('SELECT * FROM ImportantEmails WHERE id = ?').get(req.params.id));
});

router.post('/:id/to-task', (req, res) => {
  const email: any = db.prepare('SELECT * FROM ImportantEmails WHERE id = ?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });

  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO Notes (title, content, tags, notebookId, isTask, taskStatus, sourceType, sourceId, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1, 0, ?, ?, ?, ?)'
  ).run(email.subject, email.bodyPreview, '', 'email', email.graphMessageId, now, now);

  res.status(201).json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(result.lastInsertRowid));
});

// --- Smart attention endpoints ---

router.get('/attention', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  res.json(getAttentionItems(limit));
});

router.get('/threads', (req, res) => {
  res.json(groupByThread());
});

router.get('/daily-summary', (req, res) => {
  res.json(getDailySummary());
});

// --- AI Email Triage ---

async function triageNewEmails(): Promise<number> {
  if (!isCopilotAuth()) return 0;

  // Get emails without AI triage
  const untriaged: any[] = db.prepare(
    "SELECT id, subject, fromName, fromEmail, bodyPreview FROM ImportantEmails WHERE aiCategory = '' LIMIT 10"
  ).all();

  if (untriaged.length === 0) return 0;

  // Batch them into one AI call for efficiency
  const emailList = untriaged.map((e, i) =>
    `[${i + 1}] From: ${e.fromName} <${e.fromEmail}>\nSubject: ${e.subject}\nPreview: ${e.bodyPreview}`
  ).join('\n\n');

  const prompt = `Analyze these emails and classify each one. Return ONLY a JSON array with one object per email, in order.

Each object must have:
- "category": one of "action_required", "fyi", "newsletter", "automated", "social"
- "priority": one of "urgent", "high", "normal", "low"
- "summary": one sentence summary (max 80 chars)
- "suggestedAction": short suggestion like "Reply", "Schedule follow-up", "Read later", "Archive", "Add to tasks"
- "actionItems": array of strings — explicit or implicit action items from the email (empty array if none)
- "deadlines": array of strings — any dates/deadlines mentioned (e.g., "2026-03-25", "end of week", "by Friday")
- "threadTopic": short topic/project name this email belongs to (e.g., "Q3 Planning", "Budget Review", "Onboarding")

Focus on precision — only flag real action items and deadlines. If unsure, leave the array empty.

Emails:
${emailList}

Return ONLY the JSON array, no markdown, no explanation.`;

  try {
    const result = await chatCompletion([
      { role: 'system', content: 'You are an email triage assistant. Classify emails precisely. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ], 'gpt-4o-mini', 0.3);

    // Parse the JSON response
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const analyses = JSON.parse(cleaned) as any[];

    const update = db.prepare(
      'UPDATE ImportantEmails SET aiCategory = ?, aiPriority = ?, aiSummary = ?, aiSuggestedAction = ?, aiActionItems = ?, aiDeadlines = ?, aiThreadTopic = ? WHERE id = ?'
    );

    const updateAll = db.transaction(() => {
      for (let i = 0; i < Math.min(analyses.length, untriaged.length); i++) {
        const a = analyses[i];
        update.run(
          a.category || 'fyi',
          a.priority || 'normal',
          a.summary || '',
          a.suggestedAction || '',
          JSON.stringify(a.actionItems || []),
          JSON.stringify(a.deadlines || []),
          a.threadTopic || '',
          untriaged[i].id
        );
      }
    });
    updateAll();

    console.log(`[Triage] Classified ${analyses.length} emails`);
    return analyses.length;
  } catch (err: any) {
    console.error('[Triage] AI classification failed:', err.message);
    return 0;
  }
}

// --- Memory graph ingestion for new emails ---
async function ingestNewEmails(): Promise<number> {
  if (!isCopilotAuth()) return 0;
  // Ingest the 10 most recent emails that haven't been seen in the graph yet
  // We use a simple heuristic: emails from the last 24 hours
  const since = new Date(Date.now() - 86400000).toISOString();
  const recent: any[] = db.prepare(
    'SELECT * FROM ImportantEmails WHERE receivedAt >= ? ORDER BY receivedAt DESC LIMIT 10'
  ).all(since);

  let count = 0;
  for (const email of recent) {
    try {
      await extractAndIngest('email', email, email.id?.toString(), email.subject);
      count++;
    } catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  if (count > 0) console.log(`[MemoryGraph] Ingested ${count} emails into graph`);
  return count;
}

export default router;
