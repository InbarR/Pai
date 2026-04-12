import db from '../db';
import { searchNodes, getEdgesFrom } from './memory-graph';
import { scanOpenDocs, scanRecentDocs } from './file-scanner';

export interface ViewItem {
  file: string;
  path?: string;
  type?: string;
  reason: string;
  score: number;
}

export interface GroupedView {
  name: string;
  items?: ViewItem[];
  groups?: { label: string; items: ViewItem[] }[];
}

export interface FileViews {
  views: GroupedView[];
  whatMattersNow: ViewItem[];
}

export async function generateFileViews(): Promise<FileViews> {
  const views: GroupedView[] = [];

  // 0. Currently open files (always available, no graph needed)
  try {
    const openDocs = await scanOpenDocs();
    if (openDocs.length > 0) {
      views.push({
        name: 'Currently Open',
        items: openDocs.map(d => ({ file: d.title, path: d.path, type: d.type, reason: `Open in ${d.app || d.source}`, score: 1.0 })),
      });
    }
  } catch {}

  // 0b. Recent files
  try {
    const recentDocs = await scanRecentDocs();
    if (recentDocs.length > 0) {
      views.push({
        name: 'Recent',
        items: recentDocs.slice(0, 10).map(d => ({ file: d.title, path: d.path, type: d.type, reason: d.source || 'Recent', score: 0.8 })),
      });
    }
  } catch {}

  // 1. My Day — files from today's context
  const myDay = getMyDayView();
  if (myDay.length > 0) views.push({ name: 'My Day', items: myDay });

  // 2. Needs Attention
  const attention = getNeedsAttentionView();
  if (attention.length > 0) views.push({ name: 'Needs Attention', items: attention });

  // 3. Projects — grouped by inferred project
  const projects = getProjectsView();
  if (projects.length > 0) views.push({ name: 'Projects', groups: projects });

  // 4. People — grouped by associated person
  const people = getPeopleView();
  if (people.length > 0) views.push({ name: 'People', groups: people });

  // Collect top items across all views
  const allItems = views.flatMap(v => v.items || v.groups?.flatMap(g => g.items) || [])
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const whatMattersNow: ViewItem[] = [];
  for (const item of allItems) {
    if (seen.has(item.file)) continue;
    seen.add(item.file);
    whatMattersNow.push(item);
    if (whatMattersNow.length >= 5) break;
  }

  return { views, whatMattersNow };
}

function getMyDayView(): ViewItem[] {
  const items: ViewItem[] = [];

  // Files mentioned in tasks due today or in progress
  const today = new Date().toISOString().split('T')[0];
  const tasks = db.prepare(
    `SELECT title, content FROM Notes WHERE isTask = 1 AND (taskStatus = 1 OR dueDate = ?) LIMIT 10`
  ).all(today) as any[];

  for (const task of tasks) {
    // Search memory graph for file entities connected to this task
    const taskNodes = searchNodes(task.title, 'task');
    for (const node of taskNodes.slice(0, 1)) {
      const edges = getEdgesFrom(node.id);
      for (const e of edges) {
        if (e.toNode.type === 'file') {
          items.push({
            file: e.toNode.name,
            reason: `Related to task: ${task.title}`,
            score: 0.9,
          });
        }
      }
    }
  }

  // Files from memory graph with recent activity
  const recentFileNodes = db.prepare(
    `SELECT name, attributes, lastSeen FROM MemoryNodes WHERE type = 'file' AND lastSeen >= datetime('now', '-1 day') ORDER BY mentions DESC LIMIT 5`
  ).all() as any[];

  for (const node of recentFileNodes) {
    if (!items.find(i => i.file === node.name)) {
      items.push({
        file: node.name,
        reason: 'Recently active in your workflow',
        score: 0.7,
      });
    }
  }

  return items.slice(0, 10);
}

function getNeedsAttentionView(): ViewItem[] {
  const items: ViewItem[] = [];

  // Files tied to open tasks that are overdue or in progress
  const tasks = db.prepare(
    `SELECT title, dueDate, taskStatus FROM Notes WHERE isTask = 1 AND taskStatus < 2 ORDER BY dueDate ASC LIMIT 10`
  ).all() as any[];

  for (const task of tasks) {
    const fileNodes = searchNodes(task.title, 'file');
    for (const node of fileNodes.slice(0, 1)) {
      const overdue = task.dueDate && task.dueDate < new Date().toISOString().split('T')[0];
      items.push({
        file: node.name,
        reason: overdue ? `Overdue task: ${task.title}` : `Open task: ${task.title}`,
        score: overdue ? 1.0 : 0.7,
      });
    }
  }

  // Files from urgent/action-required emails
  const urgentEmails = db.prepare(
    `SELECT subject FROM ImportantEmails WHERE isActioned = 0 AND aiPriority IN ('urgent', 'high') ORDER BY receivedAt DESC LIMIT 10`
  ).all() as any[];

  for (const email of urgentEmails) {
    const fileNodes = searchNodes(email.subject, 'file');
    for (const node of fileNodes.slice(0, 1)) {
      if (!items.find(i => i.file === node.name)) {
        items.push({
          file: node.name,
          reason: `Referenced in urgent email: ${email.subject}`,
          score: 0.85,
        });
      }
    }
  }

  return items.slice(0, 10);
}

function getProjectsView(): { label: string; items: ViewItem[] }[] {
  const projectNodes = db.prepare(
    `SELECT id, name FROM MemoryNodes WHERE type = 'project' ORDER BY mentions DESC LIMIT 10`
  ).all() as any[];

  const groups: { label: string; items: ViewItem[] }[] = [];

  for (const project of projectNodes) {
    const edges = getEdgesFrom(project.id);
    const files = edges.filter(e => e.toNode.type === 'file').map(e => ({
      file: e.toNode.name,
      reason: `Part of project "${project.name}"`,
      score: Math.min(1.0, e.weight / 3),
    }));

    if (files.length > 0) {
      groups.push({ label: project.name, items: files.slice(0, 5) });
    }
  }

  return groups;
}

function getPeopleView(): { label: string; items: ViewItem[] }[] {
  const personNodes = db.prepare(
    `SELECT id, name FROM MemoryNodes WHERE type = 'person' ORDER BY mentions DESC LIMIT 10`
  ).all() as any[];

  const groups: { label: string; items: ViewItem[] }[] = [];

  for (const person of personNodes) {
    const edges = getEdgesFrom(person.id);
    const files = edges.filter(e => e.toNode.type === 'file').map(e => ({
      file: e.toNode.name,
      reason: `Associated with ${person.name}`,
      score: Math.min(1.0, e.weight / 3),
    }));

    if (files.length > 0) {
      groups.push({ label: person.name, items: files.slice(0, 5) });
    }
  }

  return groups;
}
