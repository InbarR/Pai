import db from '../db';

// --- Types ---

export interface MemoryNode {
  id: number;
  type: string;
  name: string;
  normalizedName: string;
  attributes: Record<string, any>;
  firstSeen: string;
  lastSeen: string;
  mentions: number;
}

export interface MemoryEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  type: string;
  weight: number;
  attributes: Record<string, any>;
  createdAt: string;
  lastSeen: string;
}

export interface MemoryFact {
  id: number;
  nodeId: number;
  fact: string;
  source: string;
  sourceId: string | null;
  sourceDetail: string | null;
  confidence: number;
  timestamp: string;
}

export interface ExtractedEntity {
  type: string;
  name: string;
  attributes?: Record<string, any>;
}

export interface ExtractedRelationship {
  fromType: string;
  fromName: string;
  toType: string;
  toName: string;
  relationType: string;
  attributes?: Record<string, any>;
}

export interface ExtractedFact {
  entityType: string;
  entityName: string;
  fact: string;
  confidence?: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  facts: ExtractedFact[];
}

// --- Normalization ---

function normalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// --- Node operations ---

export function upsertNode(type: string, name: string, attributes?: Record<string, any>): number {
  const norm = normalize(name);
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT id, attributes, mentions FROM MemoryNodes WHERE type = ? AND normalizedName = ?'
  ).get(type, norm) as any;

  if (existing) {
    const merged = { ...JSON.parse(existing.attributes || '{}'), ...(attributes || {}) };
    db.prepare(
      'UPDATE MemoryNodes SET lastSeen = ?, mentions = mentions + 1, attributes = ? WHERE id = ?'
    ).run(now, JSON.stringify(merged), existing.id);
    return existing.id;
  }

  const result = db.prepare(
    'INSERT INTO MemoryNodes (type, name, normalizedName, attributes, firstSeen, lastSeen) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(type, name.trim(), norm, JSON.stringify(attributes || {}), now, now);
  return result.lastInsertRowid as number;
}

export function findNode(type: string, name: string): MemoryNode | null {
  const row = db.prepare(
    'SELECT * FROM MemoryNodes WHERE type = ? AND normalizedName = ?'
  ).get(type, normalize(name)) as any;
  if (!row) return null;
  return { ...row, attributes: JSON.parse(row.attributes || '{}') };
}

export function getNode(id: number): MemoryNode | null {
  const row = db.prepare('SELECT * FROM MemoryNodes WHERE id = ?').get(id) as any;
  if (!row) return null;
  return { ...row, attributes: JSON.parse(row.attributes || '{}') };
}

export function searchNodes(query: string, type?: string): MemoryNode[] {
  const norm = normalize(query);
  let sql = 'SELECT * FROM MemoryNodes WHERE normalizedName LIKE ?';
  const params: any[] = [`%${norm}%`];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  sql += ' ORDER BY mentions DESC, lastSeen DESC LIMIT 50';
  return (db.prepare(sql).all(...params) as any[]).map(r => ({
    ...r, attributes: JSON.parse(r.attributes || '{}'),
  }));
}

export function getAllNodes(type?: string, limit = 100): MemoryNode[] {
  let sql = 'SELECT * FROM MemoryNodes';
  const params: any[] = [];
  if (type) { sql += ' WHERE type = ?'; params.push(type); }
  sql += ' ORDER BY mentions DESC, lastSeen DESC LIMIT ?';
  params.push(limit);
  return (db.prepare(sql).all(...params) as any[]).map(r => ({
    ...r, attributes: JSON.parse(r.attributes || '{}'),
  }));
}

// --- Edge operations ---

export function upsertEdge(fromNodeId: number, toNodeId: number, type: string, attributes?: Record<string, any>): number {
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT id, weight, attributes FROM MemoryEdges WHERE fromNodeId = ? AND toNodeId = ? AND type = ?'
  ).get(fromNodeId, toNodeId, type) as any;

  if (existing) {
    const merged = { ...JSON.parse(existing.attributes || '{}'), ...(attributes || {}) };
    db.prepare(
      'UPDATE MemoryEdges SET weight = weight + 1, lastSeen = ?, attributes = ? WHERE id = ?'
    ).run(now, JSON.stringify(merged), existing.id);
    return existing.id;
  }

  const result = db.prepare(
    'INSERT INTO MemoryEdges (fromNodeId, toNodeId, type, attributes, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(fromNodeId, toNodeId, type, JSON.stringify(attributes || {}), now, now);
  return result.lastInsertRowid as number;
}

export function getEdgesFrom(nodeId: number): (MemoryEdge & { toNode: MemoryNode })[] {
  const rows = db.prepare(`
    SELECT e.*, n.id as nId, n.type as nType, n.name as nName, n.normalizedName as nNorm,
           n.attributes as nAttr, n.firstSeen as nFirst, n.lastSeen as nLast, n.mentions as nMentions
    FROM MemoryEdges e JOIN MemoryNodes n ON e.toNodeId = n.id
    WHERE e.fromNodeId = ? ORDER BY e.weight DESC
  `).all(nodeId) as any[];

  return rows.map(r => ({
    id: r.id, fromNodeId: r.fromNodeId, toNodeId: r.toNodeId, type: r.type,
    weight: r.weight, attributes: JSON.parse(r.attributes || '{}'),
    createdAt: r.createdAt, lastSeen: r.lastSeen,
    toNode: {
      id: r.nId, type: r.nType, name: r.nName, normalizedName: r.nNorm,
      attributes: JSON.parse(r.nAttr || '{}'), firstSeen: r.nFirst, lastSeen: r.nLast, mentions: r.nMentions,
    },
  }));
}

export function getEdgesTo(nodeId: number): (MemoryEdge & { fromNode: MemoryNode })[] {
  const rows = db.prepare(`
    SELECT e.*, n.id as nId, n.type as nType, n.name as nName, n.normalizedName as nNorm,
           n.attributes as nAttr, n.firstSeen as nFirst, n.lastSeen as nLast, n.mentions as nMentions
    FROM MemoryEdges e JOIN MemoryNodes n ON e.fromNodeId = n.id
    WHERE e.toNodeId = ? ORDER BY e.weight DESC
  `).all(nodeId) as any[];

  return rows.map(r => ({
    id: r.id, fromNodeId: r.fromNodeId, toNodeId: r.toNodeId, type: r.type,
    weight: r.weight, attributes: JSON.parse(r.attributes || '{}'),
    createdAt: r.createdAt, lastSeen: r.lastSeen,
    fromNode: {
      id: r.nId, type: r.nType, name: r.nName, normalizedName: r.nNorm,
      attributes: JSON.parse(r.nAttr || '{}'), firstSeen: r.nFirst, lastSeen: r.nLast, mentions: r.nMentions,
    },
  }));
}

export function getAllEdges(limit = 500): MemoryEdge[] {
  return (db.prepare('SELECT * FROM MemoryEdges ORDER BY weight DESC, lastSeen DESC LIMIT ?').all(limit) as any[]).map(r => ({
    ...r, attributes: JSON.parse(r.attributes || '{}'),
  }));
}

// --- Fact operations ---

export function addFact(nodeId: number, fact: string, source: string, sourceId?: string, sourceDetail?: string, confidence = 1.0): number {
  const now = new Date().toISOString();
  // Avoid exact duplicate facts
  const existing = db.prepare(
    'SELECT id FROM MemoryFacts WHERE nodeId = ? AND fact = ? AND source = ?'
  ).get(nodeId, fact, source) as any;
  if (existing) return existing.id;

  const result = db.prepare(
    'INSERT INTO MemoryFacts (nodeId, fact, source, sourceId, sourceDetail, confidence, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(nodeId, fact, source, sourceId || null, sourceDetail || null, confidence, now);
  return result.lastInsertRowid as number;
}

export function getFactsForNode(nodeId: number, limit = 20): MemoryFact[] {
  return db.prepare(
    'SELECT * FROM MemoryFacts WHERE nodeId = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(nodeId, limit) as MemoryFact[];
}

// --- Timeline ---

export function getTimeline(days = 7, limit = 50): MemoryFact[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(
    'SELECT f.*, n.name as entityName, n.type as entityType FROM MemoryFacts f JOIN MemoryNodes n ON f.nodeId = n.id WHERE f.timestamp >= ? ORDER BY f.timestamp DESC LIMIT ?'
  ).all(since, limit) as any[];
}

// --- Ingest extraction result ---

export function ingestExtraction(extraction: ExtractionResult, source: string, sourceId?: string, sourceDetail?: string) {
  // 1. Upsert all entities
  const nodeMap = new Map<string, number>(); // "type:normalizedName" -> nodeId
  for (const entity of extraction.entities) {
    const id = upsertNode(entity.type, entity.name, entity.attributes);
    nodeMap.set(`${entity.type}:${normalize(entity.name)}`, id);
  }

  // helper to resolve a node id
  const resolveNode = (type: string, name: string): number => {
    const key = `${type}:${normalize(name)}`;
    if (nodeMap.has(key)) return nodeMap.get(key)!;
    const id = upsertNode(type, name);
    nodeMap.set(key, id);
    return id;
  };

  // 2. Upsert relationships
  for (const rel of extraction.relationships) {
    const fromId = resolveNode(rel.fromType, rel.fromName);
    const toId = resolveNode(rel.toType, rel.toName);
    if (fromId !== toId) {
      upsertEdge(fromId, toId, rel.relationType, rel.attributes);
    }
  }

  // 3. Add facts
  for (const f of extraction.facts) {
    const nodeId = resolveNode(f.entityType, f.entityName);
    addFact(nodeId, f.fact, source, sourceId, sourceDetail, f.confidence ?? 1.0);
  }
}

// --- Graph summary for AI queries ---

export function getGraphSummary(): { nodeCount: number; edgeCount: number; factCount: number; topEntities: any[] } {
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM MemoryNodes').get() as any).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM MemoryEdges').get() as any).c;
  const factCount = (db.prepare('SELECT COUNT(*) as c FROM MemoryFacts').get() as any).c;
  const topEntities = db.prepare(
    'SELECT type, name, mentions, lastSeen FROM MemoryNodes ORDER BY mentions DESC LIMIT 20'
  ).all();
  return { nodeCount, edgeCount, factCount, topEntities };
}

// --- Query: get full context for a node ---

export function getNodeContext(nodeId: number): {
  node: MemoryNode;
  facts: MemoryFact[];
  connections: { edge: MemoryEdge; node: MemoryNode }[];
} | null {
  const node = getNode(nodeId);
  if (!node) return null;
  const facts = getFactsForNode(nodeId, 30);
  const outEdges = getEdgesFrom(nodeId).map(e => ({ edge: e, node: e.toNode }));
  const inEdges = getEdgesTo(nodeId).map(e => ({ edge: e, node: e.fromNode }));
  return { node, facts, connections: [...outEdges, ...inEdges] };
}

// --- Query: find connections between two entities ---

export function findConnections(name1: string, name2: string): any[] {
  const nodes1 = searchNodes(name1);
  const nodes2 = searchNodes(name2);
  if (nodes1.length === 0 || nodes2.length === 0) return [];

  const results: any[] = [];
  for (const n1 of nodes1.slice(0, 3)) {
    for (const n2 of nodes2.slice(0, 3)) {
      // Direct edges
      const direct = db.prepare(
        'SELECT * FROM MemoryEdges WHERE (fromNodeId = ? AND toNodeId = ?) OR (fromNodeId = ? AND toNodeId = ?)'
      ).all(n1.id, n2.id, n2.id, n1.id) as any[];
      if (direct.length > 0) {
        results.push({ from: n1, to: n2, edges: direct, hops: 1 });
      }
      // One-hop connections (shared neighbor)
      const shared = db.prepare(`
        SELECT DISTINCT n.id, n.type, n.name FROM MemoryNodes n
        JOIN MemoryEdges e1 ON (e1.toNodeId = n.id AND e1.fromNodeId = ?) OR (e1.fromNodeId = n.id AND e1.toNodeId = ?)
        JOIN MemoryEdges e2 ON (e2.toNodeId = n.id AND e2.fromNodeId = ?) OR (e2.fromNodeId = n.id AND e2.toNodeId = ?)
        WHERE n.id != ? AND n.id != ?
        LIMIT 10
      `).all(n1.id, n1.id, n2.id, n2.id, n1.id, n2.id) as any[];
      if (shared.length > 0) {
        results.push({ from: n1, to: n2, via: shared, hops: 2 });
      }
    }
  }
  return results;
}
