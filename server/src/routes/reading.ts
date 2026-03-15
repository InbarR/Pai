import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/', (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const sql = unreadOnly
    ? 'SELECT * FROM ReadingItems WHERE isRead = 0 ORDER BY priority DESC, addedAt DESC'
    : 'SELECT * FROM ReadingItems ORDER BY priority DESC, addedAt DESC';
  res.json(db.prepare(sql).all());
});

router.post('/', (req, res) => {
  const { title, url = '', priority = 1, source = null } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO ReadingItems (title, url, source, addedAt, priority) VALUES (?, ?, ?, ?, ?)'
  ).run(title || url, url, source, now, priority);
  res.status(201).json(db.prepare('SELECT * FROM ReadingItems WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id/toggle-read', (req, res) => {
  db.prepare('UPDATE ReadingItems SET isRead = CASE WHEN isRead = 0 THEN 1 ELSE 0 END WHERE id = ?')
    .run(req.params.id);
  res.json(db.prepare('SELECT * FROM ReadingItems WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM ReadingItems WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
