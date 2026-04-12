---
id: TASK-8
title: File context panel - cross-entity connections
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:32'
updated_date: '2026-03-21 09:49'
labels:
  - feature
  - files
  - ai
  - connections
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a contextual view for files that surfaces cross-entity connections: related people (authors, editors, mentioned), emails where the file was shared/discussed, meetings where it was referenced, tasks linked to it, and similar/co-accessed files. Each connection includes a confidence score and a reason ('why'). Output is structured JSON with ranked connections and a short summary of why the file matters now.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Identify related people: authors, editors, commenters, people mentioned in content, people from related emails/meetings
- [x] #2 Find related emails: threads where the file was shared or discussed
- [x] #3 Find related meetings: events where the file was referenced or likely used
- [x] #4 Find related tasks: tasks created from or linked to the file
- [x] #5 Find related files: similar or co-accessed files in the same project/topic
- [x] #6 Rank connections by relevance (recency, frequency, explicit mentions, temporal proximity)
- [x] #7 Include a reason/explanation for each connection
- [x] #8 Output structured JSON with connections, summary, and top 3 most important connections
- [x] #9 Prefer precision over recall — high-confidence links only, no hallucinated relationships
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create services/file-connections.ts — service that takes a file (name, path) and finds related entities from the memory graph + DB:
   a. Related people: from memory graph nodes, email senders, meeting organizers
   b. Related emails: search ImportantEmails by subject/filename similarity
   c. Related meetings: search calendar events referencing the file
   d. Related tasks: search Notes where title/content references the file
   e. Related files: find files in the same group/project
2. Add API endpoint: GET /files/connections?name=...&path=...
3. Add a chat ACTION: file_connections to query connections for a file
4. Integrate into the file preview panel (FilesPage.tsx) — show connections below file metadata
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built cross-entity file connections panel.

Changes:
- **file-connections.ts** (new service): Takes a file name/path and finds related entities across the system. Searches memory graph for connected nodes, scans ImportantEmails for subject matches, finds related tasks from Notes, and discovers co-occurring files. Each connection includes a reason and confidence score.
- **files.ts route**: Added GET /files/connections?name=...&path=... endpoint.
- **chat.ts**: Added file_connections ACTION type so AI can look up file connections on demand.
- **FilesPage.tsx**: Preview panel now shows a "Connections" section with related people, emails, tasks, and files. Uses react-query to fetch connections when a file is selected.
- **globals.css**: Added styles for connection groups (.fe-conn-group, .fe-conn-item).
<!-- SECTION:FINAL_SUMMARY:END -->
