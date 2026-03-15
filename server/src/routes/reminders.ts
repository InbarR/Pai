import { Router } from 'express';
import db from '../db';
import { broadcast } from '../services/notification-sse';

const router = Router();

router.get('/', (req, res) => {
  const showAll = req.query.all === 'true';
  const sql = showAll
    ? 'SELECT * FROM Reminders ORDER BY dueAt DESC'
    : 'SELECT * FROM Reminders WHERE isDismissed = 0 ORDER BY dueAt ASC';
  res.json(db.prepare(sql).all());
});

router.post('/', (req, res) => {
  const { title, description = '', dueAt, isRecurring = false, recurrenceRule = null } = req.body;
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO Reminders (title, description, dueAt, isRecurring, recurrenceRule, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, description, dueAt, isRecurring ? 1 : 0, recurrenceRule, now);
  res.status(201).json(db.prepare('SELECT * FROM Reminders WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { title, description, dueAt, isRecurring, recurrenceRule } = req.body;
  db.prepare(
    'UPDATE Reminders SET title = ?, description = ?, dueAt = ?, isRecurring = ?, recurrenceRule = ? WHERE id = ?'
  ).run(title, description, dueAt, isRecurring ? 1 : 0, recurrenceRule, req.params.id);
  res.json(db.prepare('SELECT * FROM Reminders WHERE id = ?').get(req.params.id));
});

router.post('/:id/dismiss', (req, res) => {
  const reminder: any = db.prepare('SELECT * FROM Reminders WHERE id = ?').get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });

  if (reminder.isRecurring && reminder.recurrenceRule) {
    const current = new Date(reminder.dueAt);
    let next: Date;
    switch (reminder.recurrenceRule) {
      case 'daily': next = new Date(current.getTime() + 86400000); break;
      case 'weekly': next = new Date(current.getTime() + 604800000); break;
      case 'monthly': next = new Date(current); next.setMonth(next.getMonth() + 1); break;
      default: next = new Date(current.getTime() + 86400000);
    }
    db.prepare('UPDATE Reminders SET dueAt = ?, snoozedUntil = NULL WHERE id = ?')
      .run(next.toISOString(), req.params.id);
  } else {
    db.prepare('UPDATE Reminders SET isDismissed = 1 WHERE id = ?').run(req.params.id);
  }
  res.json(db.prepare('SELECT * FROM Reminders WHERE id = ?').get(req.params.id));
});

router.post('/:id/snooze', (req, res) => {
  const { minutes = 15 } = req.body;
  const snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString();
  db.prepare('UPDATE Reminders SET snoozedUntil = ? WHERE id = ?').run(snoozedUntil, req.params.id);
  res.json(db.prepare('SELECT * FROM Reminders WHERE id = ?').get(req.params.id));
});

// Fire notification after 5s delay (for testing — gives time to close the window)
router.post('/:id/test', (req, res) => {
  const reminder: any = db.prepare('SELECT * FROM Reminders WHERE id = ?').get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });

  res.json({ ok: true, message: 'Notification will fire in 5 seconds' });

  setTimeout(() => {
    broadcast('reminder-due', {
      id: reminder.id,
      title: reminder.title,
      description: reminder.description,
      dueAt: reminder.dueAt,
    });
  }, 5000);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM Reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
