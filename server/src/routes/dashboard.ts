import { Router } from 'express';
import db from '../db';
import { getTodayCalendar } from '../services/graph';

const router = Router();

router.get('/', async (req, res) => {
  const now = new Date().toISOString();

  const activeReminderCount = (db.prepare(
    'SELECT COUNT(*) as count FROM Reminders WHERE isDismissed = 0'
  ).get() as any).count;

  const nextReminder = db.prepare(
    'SELECT * FROM Reminders WHERE isDismissed = 0 AND dueAt >= ? ORDER BY dueAt ASC LIMIT 1'
  ).get(now) as any;

  const unreadReadingCount = (db.prepare(
    'SELECT COUNT(*) as count FROM ReadingItems WHERE isRead = 0'
  ).get() as any).count;

  const openTaskCount = (db.prepare(
    'SELECT COUNT(*) as count FROM TaskItems WHERE status = 0'
  ).get() as any).count;

  const inProgressTaskCount = (db.prepare(
    'SELECT COUNT(*) as count FROM TaskItems WHERE status = 1'
  ).get() as any).count;

  const unreadEmailCount = (db.prepare(
    'SELECT COUNT(*) as count FROM ImportantEmails WHERE isActioned = 0'
  ).get() as any).count;

  const noteCount = (db.prepare(
    'SELECT COUNT(*) as count FROM Notes'
  ).get() as any).count;

  const upcomingReminders = db.prepare(
    'SELECT * FROM Reminders WHERE isDismissed = 0 ORDER BY dueAt ASC LIMIT 5'
  ).all();

  const recentTasks = db.prepare(
    'SELECT * FROM TaskItems WHERE status != 2 ORDER BY dueDate ASC LIMIT 5'
  ).all();

  const recentEmails = db.prepare(
    'SELECT * FROM ImportantEmails ORDER BY receivedAt DESC LIMIT 5'
  ).all();

  // Today's meetings from Outlook
  let todayMeetings: any[] = [];
  try {
    const events = await getTodayCalendar();
    todayMeetings = (events || []).map((e: any) => ({
      subject: e.subject,
      start: e.start,
      end: e.end,
      location: e.location || '',
      organizer: e.organizer || '',
      isOnline: e.isOnline || false,
      joinUrl: e.joinUrl || '',
    }));
  } catch { /* Outlook may not be running */ }

  res.json({
    activeReminderCount,
    nextReminder,
    unreadReadingCount,
    openTaskCount,
    inProgressTaskCount,
    unreadEmailCount,
    noteCount,
    upcomingReminders,
    recentTasks,
    recentEmails,
    todayMeetings,
  });
});

export default router;
