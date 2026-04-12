---
id: TASK-11
title: Dashboard - show today's meetings
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 12:39'
updated_date: '2026-03-21 12:39'
labels:
  - feature
  - dashboard
  - calendar
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a Today's Meetings section to the dashboard page that shows all calendar events for the day with time, subject, location, organizer, join links, and live/past indicators.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fetch today's calendar events from Outlook bridge via dashboard API
- [x] #2 Display meetings on dashboard with time, duration, subject, location, organizer
- [x] #3 Highlight currently live meetings with a LIVE badge and accent border
- [x] #4 Dim past meetings
- [x] #5 Show clickable join links for online meetings
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Today's Meetings to the dashboard.\n\nChanges:\n- **dashboard.ts**: Added getTodayCalendar() call to dashboard API — fetches events from Outlook bridge, returns slimmed data (subject, start, end, location, organizer, isOnline, joinUrl). Wrapped in try/catch so dashboard still works if Outlook is not running.\n- **types.ts**: Added CalendarEvent interface and todayMeetings field to DashboardData.\n- **DashboardPage.tsx**: New meetings section after glance cards. Each meeting shows: time + duration, subject (clickable if join URL exists), location/online indicator, organizer. Meetings happening now get a LIVE badge, accent border, and a join button. Past meetings are dimmed.\n- **globals.css**: Added .meeting-item, .meeting-time, .meeting-details, .meeting-live-badge, .meeting-join-btn styles.
<!-- SECTION:FINAL_SUMMARY:END -->
