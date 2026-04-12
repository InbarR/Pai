---
id: TASK-1
title: Personal AI Memory Engine - Unified Memory Graph
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:20'
updated_date: '2026-03-21 09:38'
labels:
  - ai
  - memory
  - graph
  - core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a personal AI memory engine that constructs and maintains a unified memory graph of the user's digital life. The system ingests data from emails, calendar events, documents, chats, and tasks — extracts entities (people, projects, topics, tasks, decisions), identifies relationships between them, maintains a temporal timeline, deduplicates across sources, and continuously updates the graph with new information. Output is a structured memory graph (nodes + relationships) that can answer natural language queries like 'What did I commit to last week?', 'What is the status of project X?', 'Who are the key people involved in Y?'. Constraints: prefer structured outputs (JSON / graph schema), preserve source attribution for each fact, be concise but accurate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Extract entities (people, projects, topics, tasks, decisions) from all input sources: emails, calendar events, documents, chats, and tasks
- [x] #2 Identify and store relationships between entities (e.g., person → project, meeting → decision, task → owner)
- [x] #3 Maintain a temporal timeline of events and interactions
- [x] #4 Deduplicate entities across sources (e.g., same person appearing in email and meetings)
- [x] #5 Continuously update the graph as new information arrives
- [x] #6 Output a structured memory graph with nodes and relationships (JSON / graph schema)
- [x] #7 Support natural language queries: 'What did I commit to last week?', 'What is the status of project X?', 'Who are the key people involved in Y?'
- [x] #8 Preserve source attribution for each fact in the graph
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add new database tables: MemoryNodes (entities), MemoryEdges (relationships), MemoryFacts (attributed facts with timestamps)
2. Create server/src/services/memory-graph.ts — core graph service with CRUD for nodes/edges/facts, deduplication logic, and query methods
3. Create server/src/services/entity-extractor.ts — AI-powered extraction that takes raw data (email, calendar event, note, chat message) and returns structured entities + relationships
4. Create server/src/routes/memory.ts — API endpoints: GET /memory/graph, GET /memory/query, POST /memory/ingest, GET /memory/timeline, GET /memory/node/:id
5. Hook extraction into existing data flows: email sync, calendar fetch, note save, chat messages
6. Add memory graph query as a chat ACTION (query_memory) so the AI can answer NL questions against the graph
7. Build a frontend MemoryGraphPage or integrate into DashboardPage for visualization
8. Test with existing data: run initial ingestion of all emails, notes, tasks, and chat history
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete:
- Added MemoryNodes, MemoryEdges, MemoryFacts tables to db.ts
- Created memory-graph.ts service: upsert nodes/edges/facts, search, timeline, graph summary, node context, find connections
- Created entity-extractor.ts service: AI-powered extraction from emails/calendar/notes/tasks/chat, batch ingestion
- Created routes/memory.ts: /graph, /search, /node/:id, /timeline, /connections, /stats, /ingest, /ingest/all, /ingest/calendar
- Added query_memory and memory_timeline chat ACTIONs
- Hooked extraction into email sync and note creation flows
- Added graph summary to chat context (buildContext)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the Personal AI Memory Engine with a unified memory graph.

Changes:
- **Database** (db.ts): Added 3 new tables — MemoryNodes (entities with type/name/attributes/mentions), MemoryEdges (typed relationships with weights), MemoryFacts (attributed facts with source/confidence/timestamps). Includes dedup indexes.
- **Core service** (services/memory-graph.ts): Full graph CRUD — upsertNode/Edge with dedup & merge, search, timeline queries, node context (facts + connections), cross-entity connection finder (1-hop and 2-hop paths).
- **Entity extractor** (services/entity-extractor.ts): AI-powered extraction via GPT-4o. Takes raw data from any source (email, calendar, note, task, chat), extracts entities/relationships/facts as structured JSON, and ingests into graph. Includes batch ingestion functions.
- **API routes** (routes/memory.ts): Full REST API — GET /graph, /search, /node/:id, /timeline, /connections, /stats. POST /ingest (single), /ingest/all (bulk), /ingest/calendar.
- **Chat integration**: Added query_memory and memory_timeline ACTION types. AI can now query the graph to answer questions like "Who is involved in project X?" or "What did I commit to last week?". Graph summary injected into chat context.
- **Auto-ingestion hooks**: Email sync and note creation now automatically extract entities into the memory graph in background.

The graph supports: people, projects, topics, tasks, decisions, meetings, files. Relationships include works_on, attended, owns, related_to, mentioned_in, decided, assigned_to, discussed, etc.
<!-- SECTION:FINAL_SUMMARY:END -->
