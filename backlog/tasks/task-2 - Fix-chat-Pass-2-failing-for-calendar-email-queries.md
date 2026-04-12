---
id: TASK-2
title: Fix chat Pass 2 failing for calendar/email queries
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:25'
updated_date: '2026-03-21 09:25'
labels:
  - bug
  - chat
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the chat AI fetches calendar or email data via ACTION blocks, the Pass 2 summarization call frequently fails (timeout or API error), causing the fallback to show a useless message like 'get_calendar_upcoming: Found 45 upcoming events' instead of the actual event data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Slim down calendar event data before Pass 2 (strip attendees, bodyPreview, keep only essential fields)
- [x] #2 Increase Pass 2 timeout from 30s to 40s
- [x] #3 Retry Pass 2 with gpt-4o if the original model fails
- [x] #4 Add formatFallbackData helper that renders calendar/email data as readable markdown when Pass 2 fails entirely
- [x] #5 Use compact JSON (no pretty-print) for Pass 2 data context to reduce payload size
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed chat Pass 2 summarization failures for calendar/email queries.

Changes:
- Slimmed calendar event data: stripped attendees, attendeeCount, and body fields; only send subject, start, end, location, organizer, isOnline, joinUrl to Pass 2
- Increased Pass 2 timeout from 30s to 40s
- Added automatic retry with gpt-4o when Pass 2 fails with a slower model (e.g., Claude Opus)
- Added formatFallbackData() helper that renders calendar events and emails as readable markdown bullets when all summarization attempts fail
- Switched Pass 2 data context from pretty-printed JSON to compact JSON to reduce payload size
<!-- SECTION:FINAL_SUMMARY:END -->
