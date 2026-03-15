import { Router, Request, Response } from 'express';
import {
  isAuthenticated, getGitHubToken,
  startDeviceCodeAuth, pollForToken,
  chatCompletion, chatCompletionStream,
  getModels,
} from '../services/copilot';
import { execSync } from 'child_process';
import path from 'path';
import db from '../db';

const router = Router();

const BRIDGE_PATH = path.join(__dirname, '../../../tools/outlook-bridge/bin/Release/net48/outlook-bridge.exe');

function runBridge(args: string): any {
  try {
    const result = execSync(`"${BRIDGE_PATH}" ${args}`, {
      encoding: 'utf-8', timeout: 30_000, windowsHide: true,
    });
    return JSON.parse(result.trim());
  } catch { return []; }
}

// Build context about the user's current state to inject into the system prompt
function buildContext(): string {
  const now = new Date();
  const parts: string[] = [];
  parts.push(`Current date/time: ${now.toLocaleString()}`);

  // Tasks (from Notes with isTask=1)
  const tasks = db.prepare('SELECT title, taskStatus as status, dueDate FROM Notes WHERE isTask = 1 AND taskStatus != 2 ORDER BY taskStatus, dueDate LIMIT 10').all() as any[];
  if (tasks.length > 0) {
    const statusMap = ['Todo', 'In Progress', 'Done'];
    parts.push('Open tasks:\n' + tasks.map((t: any) => `- [${statusMap[t.status]}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`).join('\n'));
  }

  // Reminders
  const reminders = db.prepare('SELECT title, dueAt FROM Reminders WHERE isDismissed = 0 ORDER BY dueAt LIMIT 5').all() as any[];
  if (reminders.length > 0) {
    parts.push('Active reminders:\n' + reminders.map((r: any) => `- ${r.title} (${r.dueAt})`).join('\n'));
  }

  // Recent notes
  const noteCount = (db.prepare('SELECT COUNT(*) as c FROM Notes').get() as any).c;
  if (noteCount > 0) parts.push(`Notes: ${noteCount} total`);

  // Unread emails count
  const emailCount = (db.prepare('SELECT COUNT(*) as c FROM ImportantEmails WHERE isActioned = 0').get() as any).c;
  if (emailCount > 0) parts.push(`Unactioned emails: ${emailCount}`);

  return parts.join('\n\n');
}

const SYSTEM_PROMPT = `You are a helpful personal assistant integrated into a productivity app. You help the user manage their day — tasks, emails, notes, reminders, reading list, and calendar.

You have FULL ACCESS to the user's Outlook emails and calendar. You can search, read, and summarize them.

You can perform actions by including an ACTION block in your response. Format:
\`\`\`ACTION
{"type": "<action_type>", ...params}
\`\`\`

Available actions:
WRITE actions (create things):
- {"type": "add_note", "title": "...", "content": "..."}
- {"type": "add_task", "title": "...", "dueDate": "YYYY-MM-DD" (optional)}
- {"type": "add_reminder", "title": "...", "dueAt": "YYYY-MM-DDTHH:mm", "description": "" (optional)}
- {"type": "add_reading", "title": "...", "url": "...", "priority": 0|1|2}

READ actions (query data):
- {"type": "list_tasks"}
- {"type": "list_reminders"}
- {"type": "list_notes"}
- {"type": "search_emails", "query": "..."} — search emails by sender name or subject
- {"type": "get_emails", "count": 10} — get recent emails
- {"type": "get_calendar_today"} — get today's meetings
- {"type": "get_calendar_upcoming", "days": 7} — get upcoming meetings
- {"type": "get_email_body", "entryId": "..."} — get full body of a specific email (use entryId from search results)
- {"type": "open_draft", "to": "email@...", "subject": "...", "body": "<html>...</html>", "cc": "email@..."} — compose a new email and open it in Outlook desktop app

CRITICAL RULES:
- When the user asks to add/create something, you MUST include the ACTION block immediately — never say "let me do that" without including the action.
- When the user asks about emails, calendar, or meetings — you MUST use the appropriate READ action block immediately in your response. Do NOT say "let me search" or "one moment" without the ACTION block.
- You can include MULTIPLE ACTION blocks in one response if needed.
- After ACTION blocks, write a short friendly response about what you did.
- Keep responses concise. Always ACT, never just describe what you would do.
- NEVER respond with "Let me..." or "I'll..." without an ACTION block. If the user asks you to do something, DO IT with an ACTION block.`;

// Execute an action
function executeAction(action: any): { success: boolean; message: string; data?: any } {
  try {
    switch (action.type) {
      case 'add_note': {
        const now = new Date().toISOString();
        const result = db.prepare(
          'INSERT INTO Notes (title, content, tags, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)'
        ).run(action.title || 'Untitled', action.content || '', action.tags || '', now, now);
        return { success: true, message: `Note "${action.title}" created.`, data: { id: result.lastInsertRowid } };
      }
      case 'add_task': {
        const now = new Date().toISOString();
        const result = db.prepare(
          'INSERT INTO Notes (title, content, tags, notebookId, isTask, taskStatus, dueDate, sourceType, createdAt, updatedAt) VALUES (?, ?, ?, 1, 1, 0, ?, ?, ?, ?)'
        ).run(action.title, action.description || '', '', action.dueDate || null, 'chat', now, now);
        return { success: true, message: `Task "${action.title}" added.`, data: { id: result.lastInsertRowid } };
      }
      case 'add_reminder': {
        const now = new Date().toISOString();
        const result = db.prepare(
          'INSERT INTO Reminders (title, description, dueAt, isRecurring, createdAt) VALUES (?, ?, ?, ?, ?)'
        ).run(action.title, action.description || '', action.dueAt, action.isRecurring ? 1 : 0, now);
        return { success: true, message: `Reminder "${action.title}" set for ${action.dueAt}.`, data: { id: result.lastInsertRowid } };
      }
      case 'add_reading': {
        const now = new Date().toISOString();
        const result = db.prepare(
          'INSERT INTO ReadingItems (title, url, addedAt, priority) VALUES (?, ?, ?, ?)'
        ).run(action.title || action.url, action.url || '', now, action.priority ?? 1);
        return { success: true, message: `Added to reading list.`, data: { id: result.lastInsertRowid } };
      }
      case 'list_tasks': {
        const tasks = db.prepare('SELECT id, title, taskStatus as status, dueDate FROM Notes WHERE isTask = 1 AND taskStatus != 2 ORDER BY taskStatus, dueDate LIMIT 10').all();
        return { success: true, message: `Found ${tasks.length} open tasks.`, data: tasks };
      }
      case 'list_reminders': {
        const reminders = db.prepare('SELECT id, title, dueAt FROM Reminders WHERE isDismissed = 0 ORDER BY dueAt LIMIT 10').all();
        return { success: true, message: `Found ${reminders.length} active reminders.`, data: reminders };
      }
      case 'list_notes': {
        const notes = db.prepare('SELECT id, title, updatedAt FROM Notes ORDER BY updatedAt DESC LIMIT 10').all();
        return { success: true, message: `Found ${notes.length} notes.`, data: notes };
      }
      case 'search_emails': {
        const query = action.query || '';
        const emails = runBridge(`search-email "${query.replace(/"/g, '')}" 10`);
        const summary = (emails as any[]).map((e: any) => ({
          subject: e.subject,
          from: e.fromName,
          date: e.receivedAt ? new Date(e.receivedAt).toLocaleDateString() : '',
          preview: (e.bodyPreview || '').substring(0, 100),
        }));
        return { success: true, message: `Found ${summary.length} emails matching "${query}".`, data: summary };
      }
      case 'get_emails': {
        const count = action.count || 10;
        const emails = runBridge(`emails ${count}`);
        const summary = (emails as any[]).map((e: any) => ({
          subject: e.subject,
          from: e.fromName,
          date: e.receivedAt ? new Date(e.receivedAt).toLocaleDateString() : '',
          preview: (e.bodyPreview || '').substring(0, 100),
          isRead: e.isRead,
          importance: (e.importance || '').replace('olimportance', ''),
        }));
        return { success: true, message: `Retrieved ${summary.length} recent emails.`, data: summary };
      }
      case 'get_calendar_today': {
        const events = runBridge('calendar-today');
        return { success: true, message: `Found ${(events as any[]).length} events today.`, data: events };
      }
      case 'get_calendar_upcoming': {
        const days = action.days || 7;
        const events = runBridge(`calendar-upcoming ${days}`);
        return { success: true, message: `Found ${(events as any[]).length} upcoming events.`, data: events };
      }
      case 'get_email_body': {
        const emailBody = runBridge(`email-body "${(action.entryId || '').replace(/"/g, '')}"`);
        return { success: true, message: 'Email body retrieved.', data: emailBody };
      }
      case 'open_draft': {
        const to = (action.to || '').replace(/"/g, '');
        const subject = (action.subject || '').replace(/"/g, '');
        const body = (action.body || '').replace(/"/g, '\\"');
        const cc = (action.cc || '').replace(/"/g, '');
        runBridge(`open-draft "${to}" "${subject}" "${body}" "${cc}"`);
        return { success: true, message: 'Draft email opened in Outlook.' };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  } catch (err: any) {
    return { success: false, message: `Action failed: ${err.message}` };
  }
}

// Parse ACTION blocks from AI response and execute them
function processActions(aiResponse: string): { cleanedResponse: string; actions: any[] } {
  const actionRegex = /```ACTION\s*\n([\s\S]*?)```/g;
  const actions: any[] = [];
  let cleanedResponse = aiResponse;

  let match;
  while ((match = actionRegex.exec(aiResponse)) !== null) {
    try {
      const action = JSON.parse(match[1].trim());
      const result = executeAction(action);
      actions.push({ ...action, result });
    } catch { }
    cleanedResponse = cleanedResponse.replace(match[0], '').trim();
  }

  return { cleanedResponse, actions };
}

// Auth status
router.get('/auth', (req, res) => {
  res.json({ authenticated: isAuthenticated() });
});

router.get('/models', async (req, res) => {
  try {
    const models = await getModels();
    res.json(models);
  } catch (err: any) {
    res.json([]);
  }
});

// Start device code auth
router.post('/auth/start', async (req, res) => {
  try {
    const result = await startDeviceCodeAuth();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Poll for token
router.post('/auth/poll', async (req, res) => {
  try {
    const { device_code, interval } = req.body;
    const token = await pollForToken(device_code, interval);
    res.json({ success: true, token: token.substring(0, 8) + '...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Two-pass chat: AI responds with actions -> we execute -> if READ actions, feed results back for summary
router.post('/', async (req, res) => {
  try {
    const { messages, model = 'gpt-4o' } = req.body;
    const context = buildContext();

    const fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n--- CURRENT STATE ---\n' + context },
      ...messages,
    ];

    // Pass 1: get AI response (may contain ACTION blocks)
    const rawReply = await chatCompletion(fullMessages, model);
    const { cleanedResponse, actions } = processActions(rawReply);

    // Check if any READ actions returned data
    const readResults = actions.filter(a => a.result?.data && Array.isArray(a.result.data) && a.result.data.length > 0);

    if (readResults.length > 0) {
      // Pass 2: feed the data back to AI for a human-friendly response
      const dataContext = readResults.map(a =>
        `Results for ${a.type}${a.query ? ` "${a.query}"` : ''}:\n${JSON.stringify(a.result.data, null, 2)}`
      ).join('\n\n');

      const pass2Messages = [
        ...fullMessages,
        { role: 'assistant', content: rawReply },
        { role: 'system', content: `ACTION RESULTS:\n${dataContext}\n\nNow provide a helpful, concise summary of these results to the user. No ACTION blocks needed.` },
      ];

      const finalReply = await chatCompletion(pass2Messages, model);
      res.json({ reply: finalReply, actions });
    } else {
      res.json({ reply: cleanedResponse, actions });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also keep the stream endpoint for simple non-action messages
router.post('/stream', async (req: Request, res: Response) => {
  try {
    const { messages, model = 'gpt-4o' } = req.body;
    const context = buildContext();

    const fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n--- CURRENT STATE ---\n' + context },
      ...messages,
    ];

    // For streaming, use non-streaming with action support as primary path
    let rawReply: string;
    try {
      rawReply = await chatCompletion(fullMessages, model);
    } catch (err: any) {
      // If selected model fails, fallback to gpt-4o
      if (model !== 'gpt-4o') {
        console.log(`[Chat] Model ${model} failed, falling back to gpt-4o: ${err.message}`);
        rawReply = await chatCompletion(fullMessages, 'gpt-4o');
      } else {
        throw err;
      }
    }
    console.log('[Chat] Raw AI reply:', rawReply.substring(0, 500));
    const { cleanedResponse, actions } = processActions(rawReply);
    console.log('[Chat] Actions found:', actions.length, actions.map(a => a.type));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Check if any READ actions returned data — do a second pass
    const readResults = actions.filter(a => a.result?.data && Array.isArray(a.result.data) && a.result.data.length > 0);
    let finalReply = cleanedResponse;

    if (readResults.length > 0) {
      const dataContext = readResults.map(a =>
        `Results for ${a.type}${a.query ? ` "${a.query}"` : ''}:\n${JSON.stringify(a.result.data, null, 2)}`
      ).join('\n\n');

      const pass2Messages = [
        ...fullMessages,
        { role: 'assistant', content: rawReply },
        { role: 'system', content: `ACTION RESULTS:\n${dataContext}\n\nNow provide a helpful, concise summary to the user. No ACTION blocks.` },
      ];

      try {
        finalReply = await chatCompletion(pass2Messages, model);
        console.log('[Chat] Pass 2 reply:', finalReply.substring(0, 200));
      } catch (err: any) {
        console.log('[Chat] Pass 2 failed with', model, ':', err.message);
        try {
          finalReply = await chatCompletion(pass2Messages, 'gpt-4o');
          console.log('[Chat] Pass 2 fallback reply:', finalReply.substring(0, 200));
        } catch (err2: any) {
          console.log('[Chat] Pass 2 fallback also failed:', err2.message);
        }
      }
    }

    // Send the complete response as streamed chunks (simulated)
    const words = finalReply.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }

    if (actions.length > 0) {
      res.write(`data: ${JSON.stringify({ actions })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ content: `\n\nError: ${err.message}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

export default router;
