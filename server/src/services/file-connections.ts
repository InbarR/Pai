import db from '../db';
import { searchNodes, getEdgesFrom, getEdgesTo } from './memory-graph';

export interface FileConnection {
  type: 'person' | 'email' | 'meeting' | 'task' | 'file';
  name: string;
  role?: string;
  reason: string;
  confidence: number;
  timestamp?: string;
  status?: string;
}

export interface FileConnectionResult {
  file: string;
  summary: string;
  topConnections: FileConnection[];
  connections: {
    people: FileConnection[];
    emails: FileConnection[];
    meetings: FileConnection[];
    tasks: FileConnection[];
    relatedFiles: FileConnection[];
  };
}

export function getFileConnections(fileName: string, filePath?: string): FileConnectionResult {
  const connections: FileConnectionResult = {
    file: fileName,
    summary: '',
    topConnections: [],
    connections: {
      people: [],
      emails: [],
      meetings: [],
      tasks: [],
      relatedFiles: [],
    },
  };

  const searchTerms = buildSearchTerms(fileName);

  // 1. Find related people from memory graph
  const fileNodes = searchNodes(fileName, 'file');
  for (const node of fileNodes.slice(0, 3)) {
    const edges = [...getEdgesFrom(node.id), ...getEdgesTo(node.id)];
    for (const edge of edges) {
      const related = 'toNode' in edge ? edge.toNode : (edge as any).fromNode;
      if (!related) continue;
      if (related.type === 'person') {
        connections.connections.people.push({
          type: 'person',
          name: related.name,
          role: edge.type,
          reason: `Connected via ${edge.type} in memory graph`,
          confidence: Math.min(1.0, edge.weight / 5),
        });
      }
    }
  }

  // 2. Find people from related emails
  const emailPeople = findPeopleFromEmails(searchTerms);
  for (const p of emailPeople) {
    if (!connections.connections.people.find(c => c.name.toLowerCase() === p.name.toLowerCase())) {
      connections.connections.people.push(p);
    }
  }

  // 3. Find related emails
  connections.connections.emails = findRelatedEmails(searchTerms);

  // 4. Find related tasks
  connections.connections.tasks = findRelatedTasks(searchTerms);

  // 5. Find related files (same source/group)
  if (filePath) {
    connections.connections.relatedFiles = findRelatedFiles(fileName, filePath);
  }

  // Build summary and top connections
  const all = [
    ...connections.connections.people,
    ...connections.connections.emails,
    ...connections.connections.meetings,
    ...connections.connections.tasks,
    ...connections.connections.relatedFiles,
  ].sort((a, b) => b.confidence - a.confidence);

  connections.topConnections = all.slice(0, 3);

  const parts: string[] = [];
  if (connections.connections.people.length > 0)
    parts.push(`${connections.connections.people.length} related people`);
  if (connections.connections.emails.length > 0)
    parts.push(`${connections.connections.emails.length} related emails`);
  if (connections.connections.tasks.length > 0)
    parts.push(`${connections.connections.tasks.length} related tasks`);
  connections.summary = parts.length > 0 ? parts.join(', ') : 'No connections found yet';

  return connections;
}

function buildSearchTerms(fileName: string): string[] {
  const terms: string[] = [fileName];
  // Also search without common suffixes
  const cleaned = fileName.replace(/\s*[-_]\s*(v\d+|draft|final|copy|rev\d*)\s*/gi, '').trim();
  if (cleaned !== fileName) terms.push(cleaned);
  // Split camelCase/PascalCase
  const words = fileName.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(w => w.length > 2);
  if (words.length > 1) terms.push(words.join(' '));
  return terms;
}

function findPeopleFromEmails(searchTerms: string[]): FileConnection[] {
  const people: FileConnection[] = [];
  for (const term of searchTerms) {
    const emails = db.prepare(
      `SELECT fromName, fromEmail, subject, receivedAt FROM ImportantEmails
       WHERE subject LIKE ? OR bodyPreview LIKE ?
       ORDER BY receivedAt DESC LIMIT 10`
    ).all(`%${term}%`, `%${term}%`) as any[];

    const seen = new Set<string>();
    for (const e of emails) {
      const key = (e.fromName || e.fromEmail).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({
        type: 'person',
        name: e.fromName || e.fromEmail,
        reason: `Mentioned in email: "${e.subject}"`,
        confidence: 0.7,
        timestamp: e.receivedAt,
      });
    }
    if (people.length >= 5) break;
  }
  return people.slice(0, 5);
}

function findRelatedEmails(searchTerms: string[]): FileConnection[] {
  const results: FileConnection[] = [];
  const seen = new Set<number>();

  for (const term of searchTerms) {
    const emails = db.prepare(
      `SELECT id, subject, fromName, receivedAt FROM ImportantEmails
       WHERE subject LIKE ? ORDER BY receivedAt DESC LIMIT 5`
    ).all(`%${term}%`) as any[];

    for (const e of emails) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      results.push({
        type: 'email',
        name: e.subject,
        reason: `From ${e.fromName}, subject matches`,
        confidence: 0.8,
        timestamp: e.receivedAt,
      });
    }
    if (results.length >= 5) break;
  }
  return results.slice(0, 5);
}

function findRelatedTasks(searchTerms: string[]): FileConnection[] {
  const results: FileConnection[] = [];
  const seen = new Set<number>();

  for (const term of searchTerms) {
    const tasks = db.prepare(
      `SELECT id, title, taskStatus, dueDate FROM Notes
       WHERE isTask = 1 AND (title LIKE ? OR content LIKE ?)
       ORDER BY updatedAt DESC LIMIT 5`
    ).all(`%${term}%`, `%${term}%`) as any[];

    const statusMap = ['Todo', 'In Progress', 'Done'];
    for (const t of tasks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      results.push({
        type: 'task',
        name: t.title,
        reason: 'Title/content references this file',
        confidence: 0.7,
        status: statusMap[t.taskStatus] || 'Unknown',
      });
    }
    if (results.length >= 5) break;
  }
  return results.slice(0, 5);
}

function findRelatedFiles(fileName: string, filePath: string): FileConnection[] {
  // Use memory graph to find co-occurring files
  const fileNodes = searchNodes(fileName, 'file');
  const related: FileConnection[] = [];

  for (const node of fileNodes.slice(0, 2)) {
    // Find other file nodes connected to the same entities
    const edges = getEdgesFrom(node.id);
    for (const edge of edges) {
      if (edge.toNode.type === 'file' && edge.toNode.name !== fileName) {
        related.push({
          type: 'file',
          name: edge.toNode.name,
          reason: `Connected via ${edge.type}`,
          confidence: Math.min(1.0, edge.weight / 3),
        });
      }
    }
  }
  return related.slice(0, 5);
}
