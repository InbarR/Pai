import db from '../db';
import { broadcast } from './notification-sse';
import { execSync } from 'child_process';
import path from 'path';

const notifiedIds = new Set<number>();
const notifiedMeetings = new Set<string>();
const BRIDGE_PATH = path.join(__dirname, '../../../tools/outlook-bridge/bin/Release/net48/outlook-bridge.exe');

function runBridge(args: string): any {
  try {
    const result = execSync(`"${BRIDGE_PATH}" ${args}`, {
      encoding: 'utf-8', timeout: 15_000, windowsHide: true,
    });
    return JSON.parse(result.trim());
  } catch { return []; }
}

// Extract URLs from text
function extractUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  return (text.match(urlRegex) || []);
}

// Find join URL (Teams, Zoom, etc.)
function findJoinUrl(text: string): string | null {
  const urls = extractUrls(text);
  for (const url of urls) {
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return url;
    if (url.includes('zoom.us')) return url;
    if (url.includes('meet.google.com')) return url;
    if (url.includes('webex.com')) return url;
  }
  return null;
}

export function startReminderScheduler() {
  // Reminder check — every 30s
  setInterval(() => {
    try {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
      const nowStr = now.toISOString();
      // Only get reminders due in the last 5 minutes (not ancient ones)
      const dueReminders: any[] = db.prepare(`
        SELECT * FROM Reminders
        WHERE isDismissed = 0
          AND dueAt <= ?
          AND dueAt >= ?
          AND (snoozedUntil IS NULL OR snoozedUntil <= ?)
      `).all(nowStr, fiveMinAgo, nowStr);

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
      console.error('[Scheduler] Reminder error:', err);
    }
  }, 30_000);

  // Meeting check — every 60s
  setInterval(() => {
    try {
      const events = runBridge('calendar-today') as any[];
      if (!Array.isArray(events)) return;

      const now = new Date();
      const fiveMinFromNow = new Date(now.getTime() + 5 * 60_000);

      for (const event of events) {
        const start = new Date(event.start || event.startTime);
        const key = `${event.subject}-${start.toISOString()}`;

        // Skip if already notified or in the past
        if (notifiedMeetings.has(key)) continue;
        if (start < now) continue;

        // Notify if meeting starts within 5 minutes
        if (start <= fiveMinFromNow) {
          const joinUrl = findJoinUrl(event.body || event.location || '');
          const bodyUrls = extractUrls(event.body || '');

          broadcast('meeting-soon', {
            subject: event.subject,
            start: event.start || event.startTime,
            end: event.end || event.endTime,
            location: event.location || '',
            organizer: event.organizer || '',
            attendees: event.attendees || '',
            joinUrl,
            links: bodyUrls.filter((u: string) => u !== joinUrl).slice(0, 5),
          });
          notifiedMeetings.add(key);
        }
      }

      // Clean old meetings
      for (const key of notifiedMeetings) {
        const dateStr = key.split('-').slice(-1)[0];
        try {
          if (new Date(dateStr) < new Date(now.getTime() - 3600_000)) {
            notifiedMeetings.delete(key);
          }
        } catch {}
      }
    } catch (err) {
      console.error('[Scheduler] Meeting check error:', err);
    }
  }, 60_000);

  // Run meeting check immediately on start
  setTimeout(() => {
    try {
      const events = runBridge('calendar-today') as any[];
      if (Array.isArray(events)) {
        console.log(`[Scheduler] Found ${events.length} calendar events today`);
      }
    } catch {}
  }, 5000);

  console.log('[Scheduler] Reminder + meeting scheduler started');
}

export function clearNotified(id: number) {
  notifiedIds.delete(id);
}
