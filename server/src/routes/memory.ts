import { Router, Request, Response } from 'express';
import db from '../db';
import {
  getAllNodes, searchNodes, getNode, getNodeContext,
  getAllEdges, getGraphSummary, getTimeline, findConnections,
} from '../services/memory-graph';
import {
  extractAndIngest, ingestEmails, ingestNotes, ingestCalendarEvents, ingestChatMessages,
} from '../services/entity-extractor';

const router = Router();

// --- Graph overview ---
router.get('/graph', (req, res) => {
  const summary = getGraphSummary();
  const type = req.query.type as string | undefined;
  const nodes = getAllNodes(type, 200);
  const edges = getAllEdges(500);
  res.json({ ...summary, nodes, edges });
});

// --- Search nodes ---
router.get('/search', (req, res) => {
  const q = (req.query.q as string) || '';
  const type = req.query.type as string | undefined;
  if (!q) return res.json([]);
  const results = searchNodes(q, type);
  res.json(results);
});

// --- Get node with full context ---
router.get('/node/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const context = getNodeContext(id);
  if (!context) return res.status(404).json({ error: 'Node not found' });
  res.json(context);
});

// --- Timeline ---
router.get('/timeline', (req, res) => {
  const days = parseInt(req.query.days as string) || 7;
  const limit = parseInt(req.query.limit as string) || 50;
  const facts = getTimeline(days, limit);
  res.json(facts);
});

// --- Find connections between two entities ---
router.get('/connections', (req, res) => {
  const a = req.query.a as string;
  const b = req.query.b as string;
  if (!a || !b) return res.status(400).json({ error: 'Provide ?a=name1&b=name2' });
  const connections = findConnections(a, b);
  res.json(connections);
});

// --- Stats ---
router.get('/stats', (req, res) => {
  const summary = getGraphSummary();
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM MemoryNodes GROUP BY type ORDER BY count DESC').all();
  const bySource = db.prepare('SELECT source, COUNT(*) as count FROM MemoryFacts GROUP BY source ORDER BY count DESC').all();
  res.json({ ...summary, byType, bySource });
});

// --- Ingest a single item ---
router.post('/ingest', async (req: Request, res: Response) => {
  const { source, data, sourceId, sourceDetail } = req.body;
  if (!source || !data) return res.status(400).json({ error: 'Provide source and data' });

  try {
    const result = await extractAndIngest(source, data, sourceId, sourceDetail);
    res.json({ ok: true, extraction: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Bulk ingest from existing data ---
router.post('/ingest/all', async (req: Request, res: Response) => {
  const results: Record<string, number> = {};

  try {
    // Send immediate response, run in background
    res.json({ ok: true, message: 'Ingestion started in background. Check /api/memory/stats for progress.' });

    // Emails
    const emails = db.prepare('SELECT * FROM ImportantEmails ORDER BY receivedAt DESC LIMIT 100').all() as any[];
    if (emails.length > 0) {
      results.emails = await ingestEmails(emails);
      console.log(`[Memory] Ingested ${results.emails} emails`);
    }

    // Notes & Tasks
    const notes = db.prepare('SELECT * FROM Notes ORDER BY updatedAt DESC LIMIT 100').all() as any[];
    if (notes.length > 0) {
      results.notes = await ingestNotes(notes);
      console.log(`[Memory] Ingested ${results.notes} notes/tasks`);
    }

    // Chat messages (recent)
    const chatMsgs = db.prepare('SELECT * FROM ChatMessages ORDER BY createdAt DESC LIMIT 50').all() as any[];
    if (chatMsgs.length > 0) {
      results.chat = await ingestChatMessages(chatMsgs);
      console.log(`[Memory] Ingested ${results.chat} chat messages`);
    }

    console.log('[Memory] Bulk ingestion complete:', results);
  } catch (err: any) {
    console.log('[Memory] Bulk ingestion error:', err.message);
  }
});

// --- Ingest calendar events (requires bridge, called separately) ---
router.post('/ingest/calendar', async (req: Request, res: Response) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events)) return res.status(400).json({ error: 'Provide events array' });
  try {
    const count = await ingestCalendarEvents(events);
    res.json({ ok: true, ingested: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
