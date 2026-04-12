---
id: TASK-13
title: Fix voice input - use browser Speech Recognition
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 17:44'
updated_date: '2026-03-21 17:44'
labels:
  - bug
  - chat
  - voice
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Voice input was broken - the transcribe endpoint was a stub returning an error. Replaced MediaRecorder + server-side approach with browser-native SpeechRecognition API (works in Chrome/Edge with no server setup).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Voice input works without any API keys or server configuration
- [x] #2 Shows interim results in the input field while speaking
- [x] #3 Cleans up interim markers when speech ends
- [x] #4 Handles unsupported browsers gracefully
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced broken voice input with browser-native Speech Recognition.

The old implementation used MediaRecorder to capture audio and POST it to /api/chat/transcribe, which was a stub that always returned an error about needing Azure Speech SDK.

New implementation uses the Web Speech API (SpeechRecognition / webkitSpeechRecognition) which:
- Works natively in Chrome and Edge with zero configuration
- Provides real-time interim transcription shown in the input field
- Supports continuous recognition and auto-detects language
- Falls back gracefully with a message in unsupported browsers
- Cleans up interim markers ([... partial]) when speech ends
<!-- SECTION:FINAL_SUMMARY:END -->
