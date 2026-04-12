import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, getTestDb } from './test-db';

// Mock db module BEFORE any service imports
vi.mock('../db', () => {
  // Return a proxy that delegates to whatever getTestDb() returns at call time
  return {
    default: new Proxy({}, {
      get(_, prop) {
        
        const db = (globalThis as any).__testDb;
        if (!db) throw new Error('Test DB not initialized');
        const val = db[prop as string];
        return typeof val === 'function' ? val.bind(db) : val;
      },
    }),
  };
});

import {
  upsertNode, getNode, findNode, searchNodes, getAllNodes,
  upsertEdge, getEdgesFrom, getEdgesTo,
  addFact, getFactsForNode,
  ingestExtraction, getTimeline, getGraphSummary, getNodeContext, findConnections,
} from '../services/memory-graph';

describe('Memory Graph Service', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { teardownTestDb(); });

  describe('upsertNode', () => {
    it('creates a new node', () => {
      const id = upsertNode('person', 'John Doe', { email: 'john@test.com' });
      expect(id).toBeGreaterThan(0);
      const node = getNode(id);
      expect(node!.name).toBe('John Doe');
      expect(node!.type).toBe('person');
      expect(node!.attributes.email).toBe('john@test.com');
      expect(node!.mentions).toBe(1);
    });

    it('deduplicates by type + normalizedName', () => {
      const id1 = upsertNode('person', 'John Doe');
      const id2 = upsertNode('person', 'john doe');
      expect(id1).toBe(id2);
      expect(getNode(id1)!.mentions).toBe(2);
    });

    it('merges attributes on upsert', () => {
      const id = upsertNode('person', 'John Doe', { email: 'john@test.com' });
      upsertNode('person', 'John Doe', { role: 'PM' });
      const node = getNode(id);
      expect(node!.attributes.email).toBe('john@test.com');
      expect(node!.attributes.role).toBe('PM');
    });

    it('different types create different nodes', () => {
      const id1 = upsertNode('person', 'Alpha');
      const id2 = upsertNode('project', 'Alpha');
      expect(id1).not.toBe(id2);
    });
  });

  describe('findNode', () => {
    it('finds by type and name', () => {
      upsertNode('project', 'Project X');
      expect(findNode('project', 'project x')!.name).toBe('Project X');
    });

    it('returns null for non-existent', () => {
      expect(findNode('person', 'Nobody')).toBeNull();
    });
  });

  describe('searchNodes', () => {
    it('searches by partial name', () => {
      upsertNode('person', 'John Doe');
      upsertNode('person', 'Jane Smith');
      upsertNode('project', 'John Project');
      expect(searchNodes('john').length).toBe(2);
    });

    it('filters by type', () => {
      upsertNode('person', 'John Doe');
      upsertNode('project', 'John Project');
      const results = searchNodes('john', 'person');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('person');
    });
  });

  describe('edges', () => {
    it('creates and retrieves edges', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('project', 'Project X');
      upsertEdge(a, b, 'works_on');
      const edges = getEdgesFrom(a);
      expect(edges.length).toBe(1);
      expect(edges[0].type).toBe('works_on');
      expect(edges[0].toNode.name).toBe('Project X');
    });

    it('increments weight on duplicate edge', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('project', 'X');
      upsertEdge(a, b, 'works_on');
      upsertEdge(a, b, 'works_on');
      expect(getEdgesFrom(a)[0].weight).toBe(2);
    });

    it('getEdgesTo returns incoming edges', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('project', 'X');
      upsertEdge(a, b, 'works_on');
      const edges = getEdgesTo(b);
      expect(edges.length).toBe(1);
      expect(edges[0].fromNode.name).toBe('Alice');
    });
  });

  describe('facts', () => {
    it('adds facts with source attribution', () => {
      const id = upsertNode('person', 'Bob');
      addFact(id, 'Joined the team in Q3', 'email', 'email-123', 'Welcome email');
      const facts = getFactsForNode(id);
      expect(facts.length).toBe(1);
      expect(facts[0].source).toBe('email');
      expect(facts[0].sourceDetail).toBe('Welcome email');
    });

    it('deduplicates exact same fact', () => {
      const id = upsertNode('person', 'Bob');
      addFact(id, 'Is a PM', 'email');
      addFact(id, 'Is a PM', 'email');
      expect(getFactsForNode(id).length).toBe(1);
    });
  });

  describe('ingestExtraction', () => {
    it('ingests entities, relationships, and facts', () => {
      ingestExtraction({
        entities: [
          { type: 'person', name: 'Alice', attributes: { role: 'PM' } },
          { type: 'project', name: 'Moonshot' },
        ],
        relationships: [
          { fromType: 'person', fromName: 'Alice', toType: 'project', toName: 'Moonshot', relationType: 'works_on' },
        ],
        facts: [
          { entityType: 'person', entityName: 'Alice', fact: 'Leads the Moonshot project', confidence: 0.9 },
        ],
      }, 'email', 'e-1', 'Team Update');

      expect(findNode('person', 'Alice')!.attributes.role).toBe('PM');
      expect(findNode('project', 'Moonshot')).toBeTruthy();
      expect(getEdgesFrom(findNode('person', 'Alice')!.id)[0].toNode.name).toBe('Moonshot');
      expect(getFactsForNode(findNode('person', 'Alice')!.id)[0].confidence).toBe(0.9);
    });
  });

  describe('getTimeline', () => {
    it('returns recent facts', () => {
      const id = upsertNode('person', 'Alice');
      addFact(id, 'Presented at standup', 'calendar');
      expect(getTimeline(7, 10).length).toBe(1);
    });
  });

  describe('getGraphSummary', () => {
    it('returns correct counts', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('project', 'X');
      upsertEdge(a, b, 'works_on');
      addFact(a, 'fact1', 'email');
      const s = getGraphSummary();
      expect(s.nodeCount).toBe(2);
      expect(s.edgeCount).toBe(1);
      expect(s.factCount).toBe(1);
    });
  });

  describe('getNodeContext', () => {
    it('returns node with facts and connections', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('project', 'X');
      upsertEdge(a, b, 'works_on');
      addFact(a, 'Is a PM', 'chat');
      const ctx = getNodeContext(a);
      expect(ctx!.node.name).toBe('Alice');
      expect(ctx!.facts.length).toBe(1);
      expect(ctx!.connections.length).toBe(1);
    });

    it('returns null for missing node', () => {
      expect(getNodeContext(999)).toBeNull();
    });
  });

  describe('findConnections', () => {
    it('finds direct connections', () => {
      const a = upsertNode('person', 'Alice');
      const b = upsertNode('person', 'Bob');
      upsertEdge(a, b, 'works_with');
      const conns = findConnections('Alice', 'Bob');
      expect(conns.length).toBeGreaterThan(0);
    });
  });
});
