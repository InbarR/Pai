import { Router, Request, Response } from 'express';
import { askWorkIQ } from '../services/workiq';
import {
  isAuthenticated, getGitHubToken,
  startDeviceCodeAuth, pollForToken,
  chatCompletion, chatCompletionStream, chatCompletionStreamed,
  getModels,
} from '../services/copilot';
import { execSync } from 'child_process';
import path from 'path';
import db from '../db';
import { searchNodes, getNodeContext, getTimeline } from '../services/memory-graph';
import { buildPreferenceProfile, recordChatSignal } from '../services/preference-engine';
import { getAttentionItems, getDailySummary } from '../services/email-triage';
import { getFileConnections } from '../services/file-connections';
import { parseAdoUrl, getWorkItem, assignWorkItem, changeWorkItemState, addWorkItemComment, updateWorkItem, searchWorkItems, getMyWorkItems } from '../services/ado';

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

  // User memories
  const memories = db.prepare('SELECT key, value, category FROM ChatMemories ORDER BY updatedAt DESC').all() as any[];
  if (memories.length > 0) {
    parts.push('What you remember about the user:\n' + memories.map((m: any) => `- [${m.category}] ${m.key}: ${m.value}`).join('\n'));
  }

  // Memory graph summary
  const graphNodeCount = (db.prepare('SELECT COUNT(*) as c FROM MemoryNodes').get() as any).c;
  if (graphNodeCount > 0) {
    const topPeople = db.prepare("SELECT name FROM MemoryNodes WHERE type = 'person' ORDER BY mentions DESC LIMIT 5").all() as any[];
    const topProjects = db.prepare("SELECT name FROM MemoryNodes WHERE type = 'project' ORDER BY mentions DESC LIMIT 5").all() as any[];
    let graphCtx = `Memory graph: ${graphNodeCount} entities tracked.`;
    if (topPeople.length > 0) graphCtx += ` Key people: ${topPeople.map(p => p.name).join(', ')}.`;
    if (topProjects.length > 0) graphCtx += ` Key projects: ${topProjects.map(p => p.name).join(', ')}.`;
    graphCtx += ' Use query_memory or memory_timeline actions to look up details.';
    parts.push(graphCtx);
  }

  // Assistant customization
  const settings = db.prepare("SELECT key, value FROM AppSettings WHERE key LIKE 'assistant_%' OR key = 'user_name'").all() as any[];
  const settingsMap: Record<string, string> = {};
  for (const s of settings) settingsMap[s.key] = s.value;

  const userName = settingsMap.user_name;
  const assistantName = settingsMap.assistant_name;
  const tone = settingsMap.assistant_tone;
  const lang = settingsMap.assistant_language;
  const customInstructions = settingsMap.assistant_instructions;

  if (userName) parts.push(`The user's name is: ${userName}`);
  if (assistantName && assistantName !== 'Brian') parts.push(`Your name is: ${assistantName}`);
  if (tone && tone !== 'friendly') parts.push(`Tone: respond in a ${tone} manner`);
  if (lang && lang !== 'auto') parts.push(`Language: always respond in ${lang}`);
  if (customInstructions) parts.push(`Custom instructions from user:\n${customInstructions}`);

  // Learned preferences
  const prefProfile = buildPreferenceProfile();
  if (prefProfile) parts.push(prefProfile);

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
- {"type": "ask_workiq", "query": "..."} — query Microsoft 365 data using WorkIQ (emails, meetings, documents, Teams messages, people). Use this for complex queries across M365.
- {"type": "get_email_body", "entryId": "..."} — get full body of a specific email (use entryId from search results)
- {"type": "draft_mail", "to": "email@...", "subject": "...", "body": "plain text body", "cc": "email@..."} — draft an email and show it in chat for review. The user can then ask to send or edit it.
- {"type": "open_draft", "to": "email@...", "subject": "...", "body": "<html>...</html>", "cc": "email@..."} — open a compose window in Outlook desktop app (only when user explicitly asks to open in Outlook)

CALENDAR actions (schedule meetings):
- {"type": "schedule_meeting", "subject": "...", "start": "YYYY-MM-DDTHH:mm", "end": "YYYY-MM-DDTHH:mm", "attendees": "email1@...; email2@...", "location": "..." (optional), "body": "..." (optional), "private": true/false (optional)} — create a meeting in Outlook and send invites to attendees. Set "private": true to mark the event as private. IMPORTANT: When the user asks to schedule a meeting, first search_emails to find attendees' email addresses, then use this action. If you can't find an email, ask the user.

MEMORY actions (remember things about the user):
- {"type": "save_memory", "key": "name", "value": "John", "category": "personal"} — remember a fact about the user
- {"type": "delete_memory", "key": "name"} — forget a specific fact

KNOWLEDGE GRAPH actions (query the user's memory graph of people, projects, topics, decisions):
- {"type": "query_memory", "query": "..."} — search the memory graph for entities, relationships, and facts. Use this when the user asks about people, projects, commitments, decisions, or "what happened with X". Returns connected entities and facts with source attribution.
- {"type": "memory_timeline", "days": 7} — get a timeline of recent events and interactions from the memory graph.

EMAIL INTELLIGENCE actions:
- {"type": "email_attention"} — get prioritized list of emails needing attention, with action items, deadlines, and why each matters. Use when user asks "what needs my attention?" or "any important emails?"
- {"type": "email_daily_summary"} — get a daily email digest: urgent items, action required, today's deadlines, overdue commitments, top threads. Use when user asks "what matters today?" or wants a morning briefing.

AZURE DEVOPS (ADO) actions (manage work items, bugs, tasks in ADO):
- {"type": "ado_get", "url": "https://dev.azure.com/org/project/_workitems/edit/12345"} — get details of a work item by URL or ID. You can also pass just {"type": "ado_get", "id": 12345, "org": "microsoft", "project": "OS"}
- {"type": "ado_assign", "url": "https://dev.azure.com/...", "assignee": "Display Name or email"} — assign a work item to someone
- {"type": "ado_state", "url": "https://dev.azure.com/...", "state": "Active"} — change work item state (Active, Resolved, Closed, etc.)
- {"type": "ado_comment", "url": "https://dev.azure.com/...", "comment": "text"} — add a comment to a work item
- {"type": "ado_update", "url": "https://dev.azure.com/...", "fields": {"System.Title": "new title", "System.State": "Active"}} — update any fields
- {"type": "ado_search", "query": "search text", "org": "microsoft", "project": "OS"} — search work items by title
- {"type": "ado_my_items", "org": "microsoft", "project": "OS"} — get work items assigned to me
When the user pastes an ADO URL or mentions a work item, parse the org/project/id from the URL and use the appropriate action.

CRITICAL RULES:
- When the user asks to add/create something, you MUST include the ACTION block immediately — never say "let me do that" without including the action.
- When the user asks about emails, calendar, or meetings — you MUST use the appropriate READ action block immediately in your response. Do NOT say "let me search" or "one moment" without the ACTION block.
- You can include MULTIPLE ACTION blocks in one response if needed.
- After ACTION blocks, write a short friendly response about what you did.
- Keep responses concise. Always ACT, never just describe what you would do.
- NEVER respond with "Let me..." or "I'll..." or "One moment" without an ACTION block. If the user asks you to do something, you MUST include the ACTION block in your FIRST response.
- If the user asks about a person, ALWAYS use search_emails or ask_workiq to find info. Never say you can't find someone without trying.
- When the user asks to schedule/create a meeting: first use search_emails to find attendees' email addresses, then immediately use schedule_meeting in the SAME response. Include BOTH action blocks together — do NOT wait for a second turn.
- When showing calendar/meeting info, if a meeting has a joinUrl, format it as: **[Meeting Name](joinUrl)** so it's clickable. Always include the join link.
- Support Hebrew and English — respond in the same language the user used.
- For people lookups, prefer search_emails first (faster), then ask_workiq for deeper M365 data.
- When the user says "draft mail", "dm", "write an email", "rephrase", or "prepare a mail" — use draft_mail IMMEDIATELY with the content. Do NOT search for email addresses first — just draft the mail with the content provided. Use names as-is (e.g., @Corina, @Gal Shachor). Do NOT open Outlook unless the user explicitly says "open in Outlook".
- After showing a draft, ask if the user wants to add recipients, edit it, or open it in Outlook to send.
- MEMORY: When the user tells you something personal (name, role, preferences, team, projects, etc.), ALWAYS use save_memory to remember it. Use categories: "personal" (name, role), "preferences" (style, habits), "work" (projects, team, org). Your memories persist across all conversations — use them to personalize responses.
- If the user asks "what do you know about me" or "what do you remember", list your memories.
- When the user says "remember this" or "my name is X" or similar, save it immediately with save_memory.`;

// Execute an action
async function executeAction(action: any): Promise<{ success: boolean; message: string; data?: any }> {
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
        const slim = (events as any[]).map((e: any) => ({
          subject: e.subject, start: e.start, end: e.end,
          location: e.location || undefined, organizer: e.organizer || undefined,
          isOnline: e.isOnline || undefined, joinUrl: e.joinUrl || undefined,
        }));
        return { success: true, message: `Found ${slim.length} events today.`, data: slim };
      }
      case 'get_calendar_upcoming': {
        const days = action.days || 7;
        const events = runBridge(`calendar-upcoming ${days}`);
        const slim = (events as any[]).map((e: any) => ({
          subject: e.subject, start: e.start, end: e.end,
          location: e.location || undefined, organizer: e.organizer || undefined,
          isOnline: e.isOnline || undefined, joinUrl: e.joinUrl || undefined,
        }));
        return { success: true, message: `Found ${slim.length} upcoming events.`, data: slim };
      }
      case 'ask_workiq': {
        const answer = await askWorkIQ(action.query || '');
        return { success: true, message: answer, data: [{ response: answer }] };
      }
      case 'get_email_body': {
        const emailBody = runBridge(`email-body "${(action.entryId || '').replace(/"/g, '')}"`);
        return { success: true, message: 'Email body retrieved.', data: emailBody };
      }
      case 'draft_mail': {
        // Return draft in chat — don't open Outlook
        return {
          success: true,
          message: `**Draft Email**\n\n**To:** ${action.to || '(specify recipient)'}\n${action.cc ? `**CC:** ${action.cc}\n` : ''}**Subject:** ${action.subject || '(no subject)'}\n\n---\n\n${action.body || ''}`,
        };
      }
      case 'open_draft': {
        const to = (action.to || '').replace(/"/g, '');
        const subject = (action.subject || '').replace(/"/g, '');
        const body = (action.body || '').replace(/"/g, '\\"');
        const cc = (action.cc || '').replace(/"/g, '');
        runBridge(`open-draft "${to}" "${subject}" "${body}" "${cc}"`);
        return { success: true, message: 'Draft email opened in Outlook.' };
      }
      case 'schedule_meeting': {
        const subj = (action.subject || '').replace(/"/g, '');
        const start = (action.start || '').replace(/"/g, '');
        const end = (action.end || '').replace(/"/g, '');
        const loc = (action.location || '').replace(/"/g, '');
        const attendees = (action.attendees || '').replace(/"/g, '');
        const meetBody = (action.body || '').replace(/"/g, '\\"');
        const isPrivate = action.private ? 'true' : 'false';
        runBridge(`create-event "${subj}" "${start}" "${end}" "${loc}" "${attendees}" "${meetBody}" "false" "${isPrivate}"`);
        return { success: true, message: `Meeting "${subj}" scheduled for ${start}${attendees ? ` with ${attendees}` : ''}.` };
      }
      // --- ADO Actions ---
      case 'ado_get': {
        const parsed = action.url ? parseAdoUrl(action.url) : { org: action.org, project: action.project, id: action.id };
        if (!parsed) return { success: false, message: 'Could not parse ADO URL. Provide a valid dev.azure.com URL.' };
        const wi = await getWorkItem(parsed.id, parsed.org, parsed.project);
        return { success: true, message: `[${wi.type}] ${wi.title} (${wi.state}) — assigned to ${wi.assignedTo || 'unassigned'}`, data: [wi] };
      }
      case 'ado_assign': {
        const parsed = action.url ? parseAdoUrl(action.url) : { org: action.org, project: action.project, id: action.id };
        if (!parsed) return { success: false, message: 'Could not parse ADO URL.' };
        const result = await assignWorkItem(parsed.id, parsed.org, parsed.project, action.assignee);
        return { success: true, message: `Assigned work item ${parsed.id} to ${action.assignee}.` };
      }
      case 'ado_state': {
        const parsed = action.url ? parseAdoUrl(action.url) : { org: action.org, project: action.project, id: action.id };
        if (!parsed) return { success: false, message: 'Could not parse ADO URL.' };
        await changeWorkItemState(parsed.id, parsed.org, parsed.project, action.state);
        return { success: true, message: `Changed work item ${parsed.id} state to ${action.state}.` };
      }
      case 'ado_comment': {
        const parsed = action.url ? parseAdoUrl(action.url) : { org: action.org, project: action.project, id: action.id };
        if (!parsed) return { success: false, message: 'Could not parse ADO URL.' };
        await addWorkItemComment(parsed.id, parsed.org, parsed.project, action.comment);
        return { success: true, message: `Comment added to work item ${parsed.id}.` };
      }
      case 'ado_update': {
        const parsed = action.url ? parseAdoUrl(action.url) : { org: action.org, project: action.project, id: action.id };
        if (!parsed) return { success: false, message: 'Could not parse ADO URL.' };
        const result = await updateWorkItem(parsed.id, parsed.org, parsed.project, action.fields || {});
        return { success: true, message: `Updated work item ${parsed.id}: ${result.title} (${result.state})` };
      }
      case 'ado_search': {
        const items = await searchWorkItems(action.query, action.org, action.project);
        return { success: true, message: `Found ${items.length} work items matching "${action.query}".`, data: items };
      }
      case 'ado_my_items': {
        const items = await getMyWorkItems(action.org, action.project);
        return { success: true, message: `Found ${items.length} work items assigned to you.`, data: items };
      }
      case 'save_memory': {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO ChatMemories (key, value, category, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updatedAt = excluded.updatedAt`
        ).run(action.key, action.value, action.category || 'general', now, now);
        return { success: true, message: `Remembered: ${action.key} = ${action.value}` };
      }
      case 'delete_memory': {
        db.prepare('DELETE FROM ChatMemories WHERE key = ?').run(action.key);
        return { success: true, message: `Forgot: ${action.key}` };
      }
      case 'query_memory': {
        const query = action.query || '';
        const nodes = searchNodes(query);
        if (nodes.length === 0) {
          return { success: true, message: `No memory graph results for "${query}".`, data: [] };
        }
        // Get context for top 3 matches
        const results = nodes.slice(0, 3).map(n => {
          const ctx = getNodeContext(n.id);
          return {
            entity: { type: n.type, name: n.name, mentions: n.mentions, lastSeen: n.lastSeen },
            facts: ctx?.facts.slice(0, 5).map(f => ({ fact: f.fact, source: f.source, sourceDetail: f.sourceDetail, date: f.timestamp })) || [],
            connections: ctx?.connections.slice(0, 8).map(c => ({ type: c.edge.type, entity: c.node.name, entityType: c.node.type })) || [],
          };
        });
        return { success: true, message: `Found ${nodes.length} entities matching "${query}".`, data: results };
      }
      case 'memory_timeline': {
        const days = action.days || 7;
        const events = getTimeline(days, 30);
        return { success: true, message: `Found ${events.length} events in the last ${days} days.`, data: events };
      }
      case 'email_attention': {
        const items = getAttentionItems(10);
        return { success: true, message: `Found ${items.length} emails needing attention.`, data: items };
      }
      case 'email_daily_summary': {
        const summary = getDailySummary();
        return {
          success: true,
          message: `Daily summary: ${summary.stats.urgent} urgent, ${summary.stats.actionRequired} action required, ${summary.overdueCommitments.length} overdue.`,
          data: [summary],
        };
      }
      case 'file_connections': {
        const fileConns = getFileConnections(action.name || '', action.path);
        return {
          success: true,
          message: fileConns.summary,
          data: [fileConns],
        };
      }
      default:
        return { success: false, message: `Unknown action: ${action.type}` };
    }
  } catch (err: any) {
    return { success: false, message: `Action failed: ${err.message}` };
  }
}

// Format raw action data as readable text when Pass 2 summarization fails
function formatFallbackData(cleanedResponse: string, readResults: any[]): string {
  const parts: string[] = [];
  for (const a of readResults) {
    if (!a.result?.data || !Array.isArray(a.result.data)) continue;
    if (a.type === 'get_calendar_today' || a.type === 'get_calendar_upcoming') {
      const lines = a.result.data.map((e: any) => {
        const d = new Date(e.start);
        const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const loc = e.location ? ` — ${e.location}` : '';
        return `- **${day} ${time}**: ${e.subject}${loc}`;
      });
      parts.push(lines.join('\n'));
    } else if (a.type === 'search_emails' || a.type === 'get_emails') {
      const lines = a.result.data.map((e: any) =>
        `- **${e.subject}** from ${e.from || e.fromName} (${e.date})${e.preview ? ' — ' + e.preview : ''}`
      );
      parts.push(lines.join('\n'));
    } else if (a.type === 'query_memory' || a.type === 'memory_timeline') {
      const lines = a.result.data.map((e: any) => {
        if (e.entity) return `- **${e.entity.name}** (${e.entity.type}) — ${e.facts?.map((f: any) => f.fact).join('; ') || 'no details'}`;
        if (e.entityName) return `- **${e.entityName}**: ${e.fact}`;
        return `- ${JSON.stringify(e).substring(0, 200)}`;
      });
      parts.push(lines.join('\n'));
    } else if (a.type === 'email_attention' || a.type === 'email_daily_summary') {
      parts.push(a.result.message || JSON.stringify(a.result.data).substring(0, 1000));
    } else {
      parts.push(JSON.stringify(a.result.data, null, 2).substring(0, 2000));
    }
  }
  // If no actual data was formatted, keep the AI's original response
  if (parts.length === 0) return cleanedResponse || 'No results found.';

  // Don't use dead-end AI text like "Let me find..." as intro — replace with something useful
  const isDeadEnd = /let me|i'll|one moment|i'm searching|i need to/i.test(cleanedResponse || '');
  const intro = (!cleanedResponse?.trim() || isDeadEnd) ? 'Here\'s what I found:' : cleanedResponse.trim();
  return intro + '\n\n' + parts.join('\n\n');
}

// Parse ACTION blocks from AI response and execute them
async function processActions(aiResponse: string): Promise<{ cleanedResponse: string; actions: any[] }> {
  // Match ```ACTION ... ``` with flexible whitespace (handles \r\n, spaces, etc.)
  const actionRegex = /```ACTION\s*([\s\S]*?)```/g;
  const actions: any[] = [];
  let cleanedResponse = aiResponse;

  let match;
  while ((match = actionRegex.exec(aiResponse)) !== null) {
    try {
      const jsonStr = match[1].trim();
      if (jsonStr) {
        const action = JSON.parse(jsonStr);
        const result = await executeAction(action);
        actions.push({ ...action, result });
      }
    } catch (e: any) {
      console.log('[Chat] Failed to parse ACTION block:', e.message, match[1]?.substring(0, 100));
    }
    cleanedResponse = cleanedResponse.replace(match[0], '').trim();
  }

  // Also try to find JSON action objects without proper ``` wrapping (AI sometimes formats badly)
  if (actions.length === 0) {
    const looseRegex = /```\s*ACTION\s*[\r\n]*([\s\S]*?)[\r\n]*```/gi;
    while ((match = looseRegex.exec(aiResponse)) !== null) {
      try {
        const action = JSON.parse(match[1].trim());
        const result = await executeAction(action);
        actions.push({ ...action, result });
        cleanedResponse = cleanedResponse.replace(match[0], '').trim();
      } catch {}
    }
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
    res.json(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'claude-sonnet-4.5', 'claude-sonnet-4']);
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
    const { cleanedResponse, actions } = await processActions(rawReply);

    // Check if any READ actions returned data
    const readResults = actions.filter(a => a.result?.data && Array.isArray(a.result.data) && a.result.data.length > 0);

    if (readResults.length > 0) {
      // Pass 2: feed the data back to AI for a human-friendly response
      const dataContext = readResults.map(a =>
        `Results for ${a.type}${a.query ? ` "${a.query}"` : ''}:\n${JSON.stringify(a.result.data, null, 2)}`
      ).join('\n\n');

      const pass2Messages = [
        ...fullMessages,
        { role: 'user', content: `[System: Summarize these action results for the user. No ACTION blocks.]\n\nAssistant response: ${rawReply.substring(0, 500)}\n\nACTION RESULTS:\n${dataContext}` },
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

// Voice transcription — uses Copilot/OpenAI whisper
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    // For now, use a simple approach: tell the user voice requires Azure Speech SDK
    // In a real implementation, you'd send audio to Azure Speech or OpenAI Whisper
    res.json({ text: '', error: 'Voice transcription requires Azure Speech SDK setup. Configure AZURE_SPEECH_KEY in settings.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also keep the stream endpoint for simple non-action messages
router.post('/stream', async (req: Request, res: Response) => {
  // Hard timeout — if anything takes longer than 45s, end the response
  const hardTimeout = setTimeout(() => {
    if (!res.writableEnded) {
      console.log('[Chat] Hard timeout hit (45s)');
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ content: '\n\n(Timed out — try again or rephrase)' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(504).json({ error: 'Request timed out' });
      }
    }
  }, 30000);

  try {
    const { messages, model = 'gpt-4o' } = req.body;

    // Detect "dm" (draft mail) mode — user wants a clean email draft, no actions
    const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
    const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const isDraftMode = /^dm\b|^draft\b|write (?:a |an |the )?(?:mail|email)|rephrase|phrase (?:a |an |the )?(?:mail|email)|summariz\w* (?:as |the |a )?(?:mail|email|meeting)/i.test(lastUserText.trim());

    // Determine simple vs action message early (before it's used)
    const actionKeywords = /schedul|meeting|email|mail|calendar|remind|task|note|search|find|assign|ado|draft|dm\b|budget|send|read|what.*on my|who|attach|workiq/i;
    const isSimpleMessage = !isDraftMode && lastUserText.length < 100 && !actionKeywords.test(lastUserText);

    // Start streaming immediately so user sees progress
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendStatus = (status: string) => {
      res.write(`data: ${JSON.stringify({ status })}\n\n`);
    };
    const sendSource = (source: { label: string; kind: string; query?: string; count?: number; items?: any[] }) => {
      res.write(`data: ${JSON.stringify({ source })}\n\n`);
    };

    // For draft mode, stream directly without building full context
    if (isDraftMode) {
      // Only fetch user name (lightweight) — skip full buildContext()
      const userNameRow = db.prepare("SELECT value FROM AppSettings WHERE key = 'user_name'").get() as any;
      const userName = userNameRow?.value || '';
      const draftSystemPrompt = `You are an email drafting assistant. The user gives you content (notes, bullet points, rough text) and you output a polished, professional email. Rules:
- Output ONLY the email text. No explanations, no "Here's the draft", no ACTION blocks.
- Start with "Hi" or appropriate greeting.
- End with "Thanks,\n${userName}" or similar closing.
- Keep original intent, structure, and @mentions as-is.
- Fix grammar, improve clarity, professional but natural tone.
- If user provides a subject, include: **Subject: ...**
- Match the language the user wrote in.
- Keep it concise.`;

      const draftMessages = [
        { role: 'system', content: draftSystemPrompt },
        ...messages,
      ];

      sendStatus('Drafting...');

      // Use streaming so user sees tokens as they arrive
      const stream = await chatCompletionStream(draftMessages, 'gpt-4o');
      if (stream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: [DONE]')) continue;
            if (!line.startsWith('data: ')) continue;
            try {
              const json = JSON.parse(line.slice(6));
              const token = json.choices?.[0]?.delta?.content;
              if (token && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ content: token })}\n\n`);
              }
            } catch {}
          }
        }
      }
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      clearTimeout(hardTimeout);
      return;
    }

    // Direct handler for "who is X" — bypass AI, search AD + emails directly.
    // "find" is intentionally excluded; it's too ambiguous (find mail/note/task/etc).
    const whoMatch = lastUserText.match(/^(?:who is|look up|מי (?:זה|היא))\s+(.+)/i);
    if (whoMatch) {
      const personName = whoMatch[1].trim();
      // Skip if it's clearly not a person (mentions a noun like mail/email/note/task/file/meeting)
      if (/\b(mail|email|note|task|todo|file|doc|document|meeting|calendar|event|message|attachment|chat)\b/i.test(personName)) {
        // fall through to AI
      } else {
      sendStatus(`Looking up "${personName}"`);
      try {
        const { searchPeople } = await import('../services/people');
        sendStatus('Searching organization directory (Microsoft Graph /people)...');
        const adResults = await searchPeople(personName);
        sendStatus(`Found ${adResults.length} match${adResults.length === 1 ? '' : 'es'} in directory${adResults.length > 0 ? `: ${adResults.slice(0, 3).map(r => r.name).join(', ')}${adResults.length > 3 ? '...' : ''}` : ''}`);
        sendStatus(`Searching local email index for "${personName}"...`);
        const emailResults = await executeAction({ type: 'search_emails', query: personName });
        const emailCount = emailResults.data?.length || 0;
        sendStatus(`Found ${emailCount} matching email${emailCount === 1 ? '' : 's'}`);

        let reply = '';
        if (adResults.length > 0) {
          const p = adResults[0];
          sendStatus(`Building profile from directory entry for ${p.name}`);
          reply += `**${p.name}**\n`;
          if (p.title) reply += `${p.title}\n`;
          if (p.department) reply += `${p.department}\n`;
          if (p.email) reply += `${p.email}\n`;
          if (p.phone) reply += `Phone: ${p.phone}\n`;
          if (p.office) reply += `Office: ${p.office}\n`;
          if (p.manager) reply += `Reports to: ${p.manager}\n`;
          if (adResults.length > 1) {
            reply += `\nAlso found:\n`;
            for (const r of adResults.slice(1, 5)) {
              reply += `- **${r.name}** — ${r.title || r.department || r.email}\n`;
            }
          }
        } else {
          reply += `No org directory results for "${personName}".`;
        }

        if (emailResults.data?.length > 0) {
          reply += `\n\n**Recent emails:**\n`;
          for (const e of emailResults.data.slice(0, 5)) {
            reply += `- **${e.subject}** from ${e.from || e.fromName} (${e.date})\n`;
          }
        }

        if (adResults.length > 0) {
          sendSource({
            label: 'Microsoft Graph /people',
            kind: 'directory',
            query: personName,
            count: adResults.length,
            items: adResults.slice(0, 10).map(r => ({
              name: r.name,
              title: r.title,
              department: r.department,
              email: r.email,
              phone: r.phone,
              office: r.office,
              manager: r.manager,
            })),
          });
        }
        if (emailCount > 0) {
          sendSource({
            label: 'Local email index',
            kind: 'email',
            query: personName,
            count: emailCount,
            items: emailResults.data.slice(0, 10).map((e: any) => ({
              subject: e.subject,
              from: e.from || e.fromName,
              date: e.date,
              preview: (e.bodyPreview || '').slice(0, 200),
            })),
          });
        }

        const words = reply.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          if (!res.writableEnded) res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        clearTimeout(hardTimeout);
        return;
      } catch (err: any) {
        // Fall through to normal AI if direct lookup fails
        console.log('[Chat] Direct people lookup failed:', err.message);
      }
      } // end else (not noun-like)
    }

    // Build full context only for non-draft modes
    const context = buildContext();
    const userName = context.match(/name is: (.+)/)?.[1] || '';
    const systemPrompt = SYSTEM_PROMPT + '\n\n--- CURRENT STATE ---\n' + context;

    // For simple messages, use a tiny prompt for speed
    const simplePrompt = `You are Brian, a helpful personal assistant.${userName ? ` The user's name is ${userName}.` : ''} Be concise and friendly. Support Hebrew and English.`;

    const fullMessages = [
      { role: 'system', content: isSimpleMessage ? simplePrompt : systemPrompt },
      ...(isSimpleMessage ? messages.slice(-5) : messages),
    ];

    // Honor the user's explicit model choice. Only fall back to gpt-4o for
    // very short simple messages when the user didn't pick a specific model.
    const userPickedModel = !!model && model !== 'gpt-4o';
    const pass1Model = isSimpleMessage && !userPickedModel ? 'gpt-4o' : (model || 'gpt-4o');

    sendStatus(`Asking ${pass1Model}...`);

    // Pass 1: get AI response (may contain ACTION blocks).
    // Stream tokens to the client as they arrive so first-token latency
    // matches what the model is actually doing — no fake word-split delay.
    let rawReply: string = '';
    let streamedToClient = false;
    const onChunk = (text: string) => {
      streamedToClient = true;
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    };
    try {
      rawReply = await chatCompletionStreamed(fullMessages, pass1Model, onChunk);
    } catch (err: any) {
      if (pass1Model !== 'gpt-4o') {
        sendStatus(`${pass1Model} failed, trying gpt-4o...`);
        // If we already started streaming, wipe what's there before fallback.
        if (streamedToClient && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ replace: '' })}\n\n`);
        }
        rawReply = await chatCompletionStreamed(fullMessages, 'gpt-4o', onChunk);
      } else {
        throw err;
      }
    }
    console.log('[Chat] Raw AI reply:', rawReply.substring(0, 500));

    // For simple messages, skip action processing — just finalize.
    if (isSimpleMessage) {
      res.write('data: [DONE]\n\n');
      res.end();
      clearTimeout(hardTimeout);
      return;
    }

    sendStatus('Processing response...');
    let { cleanedResponse, actions } = await processActions(rawReply);
    // If we found ACTION blocks, replace the streamed text with the cleaned
    // version (without the ```ACTION fences) so the user doesn't see them.
    if (actions.length > 0 && streamedToClient && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ replace: cleanedResponse })}\n\n`);
    }
    console.log('[Chat] Actions found:', actions.length, actions.map(a => a.type));
    if (actions.length > 0) {
      sendStatus(`Executed ${actions.length} action(s): ${actions.map(a => `${a.type}${a.result?.success ? ' ✓' : ' ✗'}`).join(', ')}`);
    }

    // If AI didn't include actions but clearly intended to, auto-execute
    if (actions.length === 0 && /let me|one moment|i'll check|i'll search|i'll look|i'm searching|אבדוק|רגע/i.test(rawReply)) {
      console.log('[Chat] AI intended action but forgot ACTION block — auto-executing');
      const msgText = lastUserText || '';

      // Detect meeting scheduling requests
      const meetingMatch = msgText.match(/(?:sched|set up|create|book|arrange).*(?:meeting|call|sync)\b/i);
      if (meetingMatch) {
        console.log('[Chat] Detected meeting scheduling request — auto-handling');
        sendStatus('Searching for attendees...');
        // Extract names from the message
        const names = msgText.match(/with\s+(.+?)(?:\s+(?:at|on|for|today|tomorrow|next)|\s*$)/i);
        if (names) {
          const nameList = names[1].split(/\s*(?:,|and|&)\s*/i).map(n => n.trim()).filter(Boolean);
          for (const name of nameList) {
            const result = await executeAction({ type: 'search_emails', query: name });
            if (result.data && result.data.length > 0) {
              actions.push({ type: 'search_emails', query: name, result });
            }
          }
        }
        // Extract time
        const timeMatch = msgText.match(/(?:at|for)\s+(\d{1,2}[:.]\d{2}|\d{1,2}\s*(?:am|pm)?)/i);
        const dateMatch = msgText.match(/(?:today|tomorrow|on\s+\w+)/i);
        if (timeMatch && actions.length > 0) {
          // Build attendees from search results
          const attendeeEmails = actions
            .filter(a => a.result?.data?.length > 0)
            .map(a => a.result.data[0].from || a.result.data[0].fromEmail || '')
            .filter(Boolean);
          if (attendeeEmails.length > 0) {
            // Parse time
            let timeStr = timeMatch[1].replace('.', ':');
            if (!timeStr.includes(':')) timeStr += ':00';
            const dateStr = dateMatch?.[0]?.toLowerCase() === 'tomorrow'
              ? new Date(Date.now() + 86400000).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0];
            const start = `${dateStr}T${timeStr.padStart(5, '0')}`;
            const end = `${dateStr}T${String(parseInt(timeStr) + 1).padStart(2, '0')}:${timeStr.split(':')[1] || '00'}`;
            const subject = `Meeting with ${nameList?.join(', ') || 'team'}`;
            sendStatus('Creating meeting...');
            const meetResult = await executeAction({
              type: 'schedule_meeting',
              subject,
              start,
              end,
              attendees: attendeeEmails.join('; '),
            });
            actions.push({ type: 'schedule_meeting', result: meetResult });
          }
        }
      } else {
        // Generic search fallback
        sendStatus('Searching...');
        const searchQuery = msgText.replace(/^(who is|find|search|look up|מי (זה|היא)|חפש)\s*/i, '').trim();
        if (searchQuery) {
          const emailResult = await executeAction({ type: 'search_emails', query: searchQuery });
          if (emailResult.data && emailResult.data.length > 0) {
            actions.push({ type: 'search_emails', query: searchQuery, result: emailResult });
          }
        }
      }
    }

    if (actions.length > 0) {
      sendStatus(`Running: ${actions.map(a => a.type.replace(/_/g, ' ')).join(', ')}...`);
    }

    // Check if any READ actions returned data — do a second pass
    const readResults = actions.filter(a => a.result?.data && Array.isArray(a.result.data) && a.result.data.length > 0);
    let finalReply = cleanedResponse;

    if (readResults.length > 0) {
      const actionNames = actions.map(a => a.type.replace(/_/g, ' ')).join(', ');
      sendStatus(`Ran: ${actionNames}. Summarizing...`);

      // Trim data to avoid huge payloads — compact JSON, limit to 4000 chars
      const dataContext = readResults.map(a => {
        const json = JSON.stringify(a.result.data);
        return `Results for ${a.type}${a.query ? ` "${a.query}"` : ''}:\n${json.substring(0, 4000)}`;
      }).join('\n\n');

      // Pass 2: Use gpt-4o always (faster) with a minimal prompt — just summarize results
      const lastUserContent = messages.filter((m: any) => m.role === 'user').slice(-1);
      const pass2Messages = [
        { role: 'system', content: 'You summarize data results concisely for the user. No ACTION blocks. Match the user\'s language.' },
        ...lastUserContent,
        { role: 'user', content: `Summarize these results:\n${dataContext}` },
      ];

      try {
        const pass2Promise = chatCompletion(pass2Messages, 'gpt-4o');
        const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
        finalReply = await Promise.race([pass2Promise, timeoutPromise]);
        console.log('[Chat] Pass 2 reply:', finalReply.substring(0, 200));
      } catch (err: any) {
        console.log('[Chat] Pass 2 failed:', err.message, '- using fallback');
        finalReply = formatFallbackData(cleanedResponse, readResults);
      }
    } else if (actions.length > 0) {
      // Check if any action returned meaningful results
      const hasUsefulResults = actions.some(a =>
        a.result?.success && a.result?.message && !/found 0|no .* results|no .* found/i.test(a.result.message)
      );
      const actionSummary = actions.map(a => a.result?.message || `${a.type}: done`).join('\n');
      sendStatus(actionSummary);

      if (hasUsefulResults) {
        // Actions found something — include results
        const isDeadEnd = /let me|i'll|one moment|i'm searching|i need to/i.test(finalReply || '');
        if (!finalReply.trim() || isDeadEnd) {
          finalReply = actionSummary;
        } else {
          finalReply = finalReply.trim() + '\n\n' + actionSummary;
        }
      }
      // If no useful results, keep the AI's original conversational response
    }

    // Always append write action results (draft_mail, schedule_meeting, etc.) that have meaningful messages
    // This catches cases where read+write actions coexist and the write results get lost in Pass 2
    const writeResults = actions.filter(a =>
      !a.result?.data && a.result?.message && a.result.message.length > 50
      && !finalReply.includes(a.result.message)
    );
    if (writeResults.length > 0) {
      const writeSummary = writeResults.map(a => a.result.message).join('\n\n');
      if (!finalReply.includes(writeSummary)) {
        finalReply = finalReply.trim() + '\n\n' + writeSummary;
      }
    }

    // If still empty, provide a fallback
    if (!finalReply.trim()) {
      finalReply = "Done! Let me know if you need anything else.";
    }

    // Truncate very long responses to prevent UI freeze
    if (finalReply.length > 8000) {
      finalReply = finalReply.substring(0, 8000) + '\n\n...(truncated)';
    }

    // We already live-streamed rawReply. If the final reply differs (because
    // we ran a pass-2 summarizer or appended action results), replace what's
    // on the client with the full final text. Otherwise just close.
    const needsReplace = finalReply.trim() !== rawReply.trim();
    if (needsReplace && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ replace: finalReply })}\n\n`);
    }

    if (actions.length > 0) {
      res.write(`data: ${JSON.stringify({ actions })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
    clearTimeout(hardTimeout);

    // Record preference signal in background
    if (lastUserText && finalReply) {
      const msgText = lastUserText;
      try { recordChatSignal(msgText, finalReply); } catch {}
    }
  } catch (err: any) {
    clearTimeout(hardTimeout);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ content: `\n\nError: ${err.message}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// --- Assistant settings endpoints ---
router.get('/assistant-settings', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM AppSettings WHERE key LIKE 'assistant_%'").all() as any[];
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({
    assistant_name: settings.assistant_name || 'Brian',
    assistant_tone: settings.assistant_tone || 'friendly',
    assistant_language: settings.assistant_language || 'auto',
    assistant_instructions: settings.assistant_instructions || '',
    user_name: settings.user_name || '',
  });
});

router.put('/assistant-settings', (req, res) => {
  const stmt = db.prepare(
    "INSERT INTO AppSettings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [key, value] of Object.entries(req.body)) {
    if (typeof key === 'string' && key.startsWith('assistant_') || key === 'user_name') {
      stmt.run(key, String(value));
    }
  }
  res.json({ ok: true });
});

// --- Memory endpoints ---
router.get('/memories', (req, res) => {
  const memories = db.prepare('SELECT * FROM ChatMemories ORDER BY category, key').all();
  res.json(memories);
});

router.delete('/memories/:key', (req, res) => {
  db.prepare('DELETE FROM ChatMemories WHERE key = ?').run(req.params.key);
  res.json({ ok: true });
});

export default router;
