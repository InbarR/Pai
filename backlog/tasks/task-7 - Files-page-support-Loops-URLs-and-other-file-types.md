---
id: TASK-7
title: 'Files page - support Loops, URLs, and other file types'
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:30'
updated_date: '2026-03-21 09:47'
labels:
  - feature
  - files
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the Files page to support additional file types beyond standard Office docs. This includes Microsoft Loop components, URLs/bookmarks, and other non-traditional file types that appear in the user's workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Display Microsoft Loop components in the file tree and preview panel
- [x] #2 Support URL/bookmark files (.url, .webloc) with clickable links
- [x] #3 Show appropriate icons for each new file type
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added support for Loop, URLs, and additional file types.

Changes:
- **ScannedDoc type** (file-scanner.ts, FilesPage.tsx): Extended type union to include loop, onenote, visio, url, video, image.
- **detectType** (file-scanner.ts): Now detects .loop files, loop.microsoft.com URLs, .one/onenote.com, .vsdx (Visio), .url/.webloc bookmarks, video formats (mp4/mkv/avi/mov/webm), and image formats (png/jpg/gif/svg/webp).
- **Browser scanner**: Updated PowerShell doc hints to detect Loop, OneNote, and Visio window titles.
- **FileIcons.tsx**: Added icon badges for all new types — Loop (purple L), OneNote (purple N), Visio (blue V), URL (blue URL), Video (orange VID), Image (teal IMG).
<!-- SECTION:FINAL_SUMMARY:END -->
