---
id: TASK-9
title: 'Dynamic context-aware file views (My Day, Projects, People)'
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:32'
updated_date: '2026-03-21 09:51'
labels:
  - feature
  - files
  - ai
  - views
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace static folder browsing with dynamic, context-aware file views. Surface the most relevant files based on user context, activity, and intent. Views include: 'My Day' (files for today's meetings/tasks), 'Needs Attention' (unread, shared, required for upcoming meetings), 'Projects' (clustered by inferred project/topic), 'People' (grouped by associated person), 'Recent Activity'. Each file includes a reason for surfacing and a relevance score. Views update dynamically as new signals arrive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Generate 'My Day' view: files relevant to today's meetings, tasks, and recent activity
- [x] #2 Generate 'Needs Attention' view: unread, recently shared, required for meetings, tied to open tasks
- [x] #3 Generate 'Projects' view: files clustered by inferred project/topic using co-access patterns and entity overlap
- [x] #4 Generate 'People' view: files grouped by associated person
- [x] #5 Generate 'Recent Activity' view: recently opened, edited, or shared files
- [x] #6 Rank files by recency, relevance to current time, frequency, and explicit signals
- [x] #7 Include a reason for each surfaced file
- [x] #8 Provide a 'What matters now' summary (top 3-5 files across all views)
- [x] #9 Views update dynamically as new signals arrive
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create services/file-views.ts — generates dynamic views:
   a. "My Day": files from today calendar events + today tasks + recent opens
   b. "Needs Attention": recently shared, required for upcoming meetings, tied to open tasks
   c. "Projects": group files by inferred project from memory graph
   d. "People": group files by associated person
   e. "Recent": recently opened/edited
2. Add API endpoint: GET /files/views
3. Add views as a new tab in FilesPage.tsx (alongside Open/Recent)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built dynamic context-aware file views.

Changes:
- **file-views.ts** (new service): Generates smart views by querying the memory graph and database:
  - "My Day": files related to today tasks + recently active files
  - "Needs Attention": files tied to overdue/open tasks + urgent emails
  - "Projects": files grouped by inferred project from memory graph
  - "People": files grouped by associated person
  - "What Matters Now": top 5 files across all views, deduplicated
- **files.ts route**: Added GET /files/views endpoint.
- **FilesPage.tsx**: Added "Smart" tab alongside Open/Recent. Shows What Matters Now section, flat item views (My Day, Needs Attention), and grouped views (Projects, People) with expandable folders.
- **globals.css**: Added smart view styles (.fe-smart-section, .fe-smart-item, .fe-smart-reason).
<!-- SECTION:FINAL_SUMMARY:END -->
