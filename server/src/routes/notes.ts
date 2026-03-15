import { Router } from 'express';
import db from '../db';

const router = Router();

// --- Notebooks ---
router.get('/notebooks', (req, res) => {
  const notebooks = db.prepare('SELECT * FROM Notebooks ORDER BY sortOrder, name').all();
  // Add note count for each
  const counts = db.prepare('SELECT notebookId, COUNT(*) as count FROM Notes GROUP BY notebookId').all() as any[];
  const countMap: Record<number, number> = {};
  for (const c of counts) countMap[c.notebookId] = c.count;
  res.json(notebooks.map((nb: any) => ({ ...nb, noteCount: countMap[nb.id] || 0 })));
});

router.post('/notebooks', (req, res) => {
  const { name = 'New Notebook', icon = '' } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO Notebooks (name, icon, createdAt) VALUES (?, ?, ?)').run(name, icon, now);
  res.status(201).json(db.prepare('SELECT * FROM Notebooks WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/notebooks/:id', (req, res) => {
  const { name, icon } = req.body;
  db.prepare('UPDATE Notebooks SET name = ?, icon = ? WHERE id = ?').run(name, icon || '', req.params.id);
  res.json(db.prepare('SELECT * FROM Notebooks WHERE id = ?').get(req.params.id));
});

router.delete('/notebooks/:id', (req, res) => {
  // Move notes to General (id=1) before deleting
  db.prepare('UPDATE Notes SET notebookId = 1 WHERE notebookId = ?').run(req.params.id);
  db.prepare('DELETE FROM Notebooks WHERE id = ? AND id != 1').run(req.params.id);
  res.json({ ok: true });
});

// --- Notes ---
router.get('/', (req, res) => {
  const notebookId = req.query.notebookId;
  const sql = notebookId
    ? 'SELECT * FROM Notes WHERE notebookId = ? ORDER BY isPinned DESC, updatedAt DESC'
    : 'SELECT * FROM Notes ORDER BY isPinned DESC, updatedAt DESC';
  const notes = notebookId ? db.prepare(sql).all(notebookId) : db.prepare(sql).all();
  res.json(notes);
});

router.get('/search', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const notes = db.prepare(
    'SELECT * FROM Notes WHERE title LIKE ? OR content LIKE ? ORDER BY isPinned DESC, updatedAt DESC'
  ).all(q, q);
  res.json(notes);
});

router.post('/', (req, res) => {
  const { title = 'Untitled', content = '', tags = '', notebookId = 1, isTask = false, dueDate = null, sourceType = 'manual' } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO Notes (title, content, tags, notebookId, isTask, dueDate, sourceType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, content, tags, notebookId, isTask ? 1 : 0, dueDate, sourceType, now, now);
  res.status(201).json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { title, content, tags, notebookId, isPinned, isTask, taskStatus, dueDate } = req.body;
  const now = new Date().toISOString();

  const existing: any = db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    `UPDATE Notes SET title = ?, content = ?, tags = ?, notebookId = ?, isPinned = ?,
     isTask = ?, taskStatus = ?, dueDate = ?, updatedAt = ? WHERE id = ?`
  ).run(
    title ?? existing.title,
    content ?? existing.content,
    tags ?? existing.tags,
    notebookId ?? existing.notebookId,
    isPinned ?? existing.isPinned,
    isTask ?? existing.isTask,
    taskStatus ?? existing.taskStatus,
    dueDate !== undefined ? dueDate : existing.dueDate,
    now,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

// Cycle task status
router.post('/:id/cycle-status', (req, res) => {
  const note: any = db.prepare('SELECT taskStatus FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const next = (note.taskStatus + 1) % 3;
  const now = new Date().toISOString();
  db.prepare('UPDATE Notes SET taskStatus = ?, updatedAt = ? WHERE id = ?').run(next, now, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

// Toggle task mode
router.post('/:id/toggle-task', (req, res) => {
  const note: any = db.prepare('SELECT isTask FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE Notes SET isTask = ? WHERE id = ?').run(note.isTask ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

router.post('/:id/pin', (req, res) => {
  const note: any = db.prepare('SELECT isPinned FROM Notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE Notes SET isPinned = ? WHERE id = ?').run(note.isPinned ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM Notes WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM Notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
