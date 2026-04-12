---
id: TASK-5
title: Files search should auto-expand tree to show matching results
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:28'
updated_date: '2026-03-21 09:44'
labels:
  - bug
  - files
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When searching in the Files page, matching results are hidden inside collapsed folders. The tree should auto-expand to reveal matching files/folders so the user can see what matched without manually clicking through each folder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a search query matches files inside folders, auto-expand the tree path to show the matching items
- [x] #2 Matched items should be visually highlighted or distinguished from non-matching siblings
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed file search to auto-expand tree and highlight matches.

Changes in FilesPage.tsx:
- Added useEffect that auto-expands all folder groups when a search query is active
- Added highlightMatch() helper that wraps matching text in a yellow <mark> tag
- Search results now immediately visible without manual folder expansion
<!-- SECTION:FINAL_SUMMARY:END -->
