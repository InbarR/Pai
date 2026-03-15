import db from '../db';
import { broadcast } from './notification-sse';

const notifiedIds = new Set<number>();

export function startReminderScheduler() {
  setInterval(() => {
    try {
      const now = new Date().toISOString();
      const dueReminders: any[] = db.prepare(`
        SELECT * FROM Reminders
        WHERE isDismissed = 0
          AND dueAt <= ?
          AND (snoozedUntil IS NULL OR snoozedUntil <= ?)
      `).all(now, now);

      for (const reminder of dueReminders) {
        if (notifiedIds.has(reminder.id)) continue;

        broadcast('reminder-due', {
          id: reminder.id,
          title: reminder.title,
          description: reminder.description,
          dueAt: reminder.dueAt,
        });
        notifiedIds.add(reminder.id);
      }

      // Clean up dismissed
      const dismissed: any[] = db.prepare(
        'SELECT id FROM Reminders WHERE isDismissed = 1'
      ).all();
      for (const r of dismissed) {
        notifiedIds.delete(r.id);
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err);
    }
  }, 30_000); // Every 30 seconds

  console.log('[Scheduler] Reminder scheduler started (30s interval)');
}

export function clearNotified(id: number) {
  notifiedIds.delete(id);
}
