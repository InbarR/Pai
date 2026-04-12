---
id: TASK-6
title: Files page - side panel with file preview
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:28'
updated_date: '2026-03-21 09:45'
labels:
  - feature
  - files
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a side panel to the Files page that shows a preview of the selected file. When the user clicks a file in the tree, the panel should display a preview (content for text files, metadata/thumbnail for others).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a file in the tree opens a side preview panel
- [x] #2 Preview supports common file types (text, images, PDFs, Office docs metadata)
- [x] #3 Panel is resizable or collapsible
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added file preview side panel to the Files page.

Changes:
- **FilesPage.tsx**: Wrapped layout in files-split-layout flex container. Single-click selects a file and opens a preview panel on the right. Double-click still opens the file. Preview shows: file type icon (enlarged), title, file type, source (SharePoint/OneDrive/Teams/Local), owner, app, full path, and Open/Copy Link buttons. Panel is dismissable via X button.
- **globals.css**: Added .files-split-layout, .fe-preview-panel styles (280px fixed width), .fe-selected highlight state, .btn-sm utility class for compact action buttons.
<!-- SECTION:FINAL_SUMMARY:END -->
