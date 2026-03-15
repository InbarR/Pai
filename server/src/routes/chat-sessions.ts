import { Router } from 'express';
import db from '../db';

const router = Router();

// List all sessions (most recent first)
router.get('/', (req, res) => {
  const sessions = db.prepare(
    'SELECT id, title, createdAt, updatedAt FROM ChatSessions ORDER BY updatedAt DESC'
  ).all();
  res.json(sessions);
});

// Get a session with its messages
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM ChatSessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  const messages = db.prepare(
    'SELECT id, role, content, createdAt FROM ChatMessages WHERE sessionId = ? ORDER BY id ASC'
  ).all(req.params.id);

  res.json({ ...session, messages });
});

// Create a new session
router.post('/', (req, res) => {
  const { title = 'New Chat' } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO ChatSessions (title, createdAt, updatedAt) VALUES (?, ?, ?)'
  ).run(title, now, now);
  res.status(201).json(db.prepare('SELECT * FROM ChatSessions WHERE id = ?').get(result.lastInsertRowid));
});

// Add a message to a session
router.post('/:id/messages', (req, res) => {
  const { role, content } = req.body;
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO ChatMessages (sessionId, role, content, createdAt) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, role, content, now);

  // Update session title from first user message if still "New Chat"
  const session: any = db.prepare('SELECT * FROM ChatSessions WHERE id = ?').get(req.params.id);
  if (session?.title === 'New Chat' && role === 'user') {
    const shortTitle = content.length > 40 ? content.substring(0, 40) + '...' : content;
    db.prepare('UPDATE ChatSessions SET title = ?, updatedAt = ? WHERE id = ?')
      .run(shortTitle, now, req.params.id);
  } else {
    db.prepare('UPDATE ChatSessions SET updatedAt = ? WHERE id = ?').run(now, req.params.id);
  }

  res.json({ ok: true });
});

// Delete a session
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM ChatMessages WHERE sessionId = ?').run(req.params.id);
  db.prepare('DELETE FROM ChatSessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
