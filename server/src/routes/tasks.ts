import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/', (req, res) => {
  const openOnly = req.query.openOnly === 'true';
  const sql = openOnly
    ? 'SELECT * FROM TaskItems WHERE status != 2 ORDER BY status ASC, dueDate ASC'
    : 'SELECT * FROM TaskItems ORDER BY status ASC, dueDate ASC';
  res.json(db.prepare(sql).all());
});

router.post('/', (req, res) => {
  const { title, description = '', sourceType = 'manual', sourceId = null, dueDate = null } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO TaskItems (title, description, sourceType, sourceId, dueDate, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, description, sourceType, sourceId, dueDate, now);
  res.status(201).json(db.prepare('SELECT * FROM TaskItems WHERE id = ?').get(result.lastInsertRowid));
});

router.post('/:id/cycle-status', (req, res) => {
  const task: any = db.prepare('SELECT * FROM TaskItems WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const nextStatus = (task.status + 1) % 3; // 0->1->2->0
  db.prepare('UPDATE TaskItems SET status = ? WHERE id = ?').run(nextStatus, req.params.id);
  res.json(db.prepare('SELECT * FROM TaskItems WHERE id = ?').get(req.params.id));
});

router.post('/from-clipboard', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const lines = text.split('\n')
    .map((l: string) => l.trim().replace(/^[-*•]\s*/, ''))
    .filter((l: string) => l.length > 0);

  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO TaskItems (title, description, sourceType, createdAt) VALUES (?, ?, ?, ?)'
  );

  const tasks: any[] = [];
  const insertMany = db.transaction(() => {
    for (const line of lines) {
      const title = line.length > 100 ? line.substring(0, 100) + '...' : line;
      const desc = line.length > 100 ? line : '';
      const result = insert.run(title, desc, 'clipboard', now);
      tasks.push(db.prepare('SELECT * FROM TaskItems WHERE id = ?').get(result.lastInsertRowid));
    }
  });
  insertMany();

  res.status(201).json(tasks);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM TaskItems WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
