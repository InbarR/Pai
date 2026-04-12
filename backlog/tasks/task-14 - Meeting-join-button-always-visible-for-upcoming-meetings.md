---
id: TASK-14
title: Meeting join button always visible for upcoming meetings
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 17:45'
updated_date: '2026-03-21 17:45'
labels:
  - feature
  - dashboard
  - calendar
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Join button on dashboard meetings was only showing for live meetings. Now shows for all upcoming meetings with a join URL. Live meetings get a pulsing accent button, upcoming ones get a subtle outlined button that highlights on hover.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Join button visible for all non-past meetings with a joinUrl
- [x] #2 Live meetings get a pulsing accent-colored Join button
- [x] #3 Upcoming meetings get a subtle outlined Join button
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the Join button always visible for upcoming meetings on the dashboard.

Changes:
- DashboardPage.tsx: Changed condition from `m.joinUrl && isNow` to `m.joinUrl && \!isPast`. Added .live class for currently active meetings. Added text label "Join" next to the video icon.
- globals.css: Redesigned .meeting-join-btn — default is a subtle outlined button, .live variant is accent-colored with pulse animation. Hover state transitions to accent for all states.
<!-- SECTION:FINAL_SUMMARY:END -->
