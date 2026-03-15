import { execSync } from 'child_process';
import path from 'path';
import db from '../db';

// Uses the outlook-bridge .NET tool to read Outlook via COM interop.
// No auth needed — reads directly from the local Outlook application.

const BRIDGE_PATH = path.join(__dirname, '../../../tools/outlook-bridge/bin/Release/net48/outlook-bridge.exe');

function runBridge(args: string): any {
  try {
    const result = execSync(`"${BRIDGE_PATH}" ${args}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    });
    return JSON.parse(result.trim());
  } catch (err: any) {
    const msg = err.stderr || err.message || 'Bridge call failed';
    throw new Error(msg);
  }
}

export async function getAuthStatus() {
  // COM interop — always "authenticated" if Outlook is running
  try {
    runBridge('emails 1');
    return { authenticated: true, email: 'Outlook (local)', method: 'com' };
  } catch {
    return { authenticated: false, email: null, method: 'com', hint: 'Make sure Outlook is running' };
  }
}

// ===== Email operations =====

export async function syncEmails(): Promise<number> {
  const emails = runBridge('emails 30') as any[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ImportantEmails
    (graphMessageId, subject, fromName, fromEmail, receivedAt, bodyPreview, isRead, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let newCount = 0;
  const insertMany = db.transaction(() => {
    for (const msg of emails) {
      // Normalize importance (COM returns "olimportancenormal" etc.)
      let importance = (msg.importance || 'normal').replace('olimportance', '');
      const result = insert.run(
        msg.id,
        msg.subject || '(no subject)',
        msg.fromName || 'Unknown',
        msg.fromEmail || '',
        msg.receivedAt || '',
        msg.bodyPreview || '',
        msg.isRead ? 1 : 0,
        importance
      );
      if (result.changes > 0) newCount++;
    }
  });
  insertMany();
  return newCount;
}

// ===== Email folders =====

export async function getEmailFolders(): Promise<any> {
  return runBridge('folders');
}

export async function getFolderEmails(folderPath: string, count: number = 30): Promise<any[]> {
  return runBridge(`folder-emails "${folderPath}" ${count}`) as any[];
}

// ===== Email body ====

export async function getEmailBody(entryId: string): Promise<any> {
  return runBridge(`email-body "${entryId}"`);
}

// ===== Calendar operations =====

export async function getTodayCalendar(): Promise<any[]> {
  return runBridge('calendar-today') as any[];
}

export async function getUpcomingCalendar(days: number = 7): Promise<any[]> {
  return runBridge(`calendar-upcoming ${days}`) as any[];
}
