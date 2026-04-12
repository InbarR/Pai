---
id: TASK-3
title: Adaptive User Preference Learning Engine
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:27'
updated_date: '2026-03-21 09:41'
labels:
  - ai
  - personalization
  - core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a personal AI system that learns and adapts to the user's preferences by observing behavior patterns. Infers writing tone, communication style, priorities, and decision patterns from user edits, feedback, and accepted/rejected suggestions. Stores preferences as structured attributes and applies them when generating responses or actions. Preferences should evolve over time and require patterns (not overfit to single examples).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Observe user edits, feedback, and accepted/rejected suggestions to infer preferences
- [x] #2 Infer and store writing tone preferences (formal, concise, friendly, etc.)
- [x] #3 Infer and store communication style preferences (length, structure, wording)
- [x] #4 Track user priorities (what they focus on or respond to quickly)
- [x] #5 Detect decision patterns from repeated behavior
- [x] #6 Store preferences as structured attributes that evolve over time
- [x] #7 Apply learned preferences when generating responses or taking actions
- [x] #8 Require patterns before inferring preferences (no overfitting to single examples)
- [x] #9 Be transparent when making strong assumptions about user preferences
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add UserPreferences table to db.ts — stores preference key, value, confidence, evidence count, last updated
2. Create services/preference-engine.ts — core engine that:
   a. Records signals (user edits, feedback, response ratings, behavior patterns)
   b. Analyzes accumulated signals to infer preferences (requires 3+ signals before confidence > 0.7)
   c. Stores/updates preferences with decay over time
   d. Provides a preference profile for the chat system
3. Add preference signals API route (routes/preferences.ts) — POST /signal (record behavior), GET /profile (get current preferences)
4. Integrate into chat: inject preference profile into system prompt so AI adapts tone, length, structure
5. Add preference observation hooks: track which chat responses the user interacts with (copies, follows up on, ignores)
6. Add transparency: when preferences change significantly, note it in chat context
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the Adaptive User Preference Learning Engine.

Changes:
- **Database** (db.ts): Added UserPreferences table (category/key/value/confidence/evidenceCount) and PreferenceSignals table (signalType/context/value/metadata).
- **Preference engine** (services/preference-engine.ts): Records behavioral signals, analyzes patterns to infer preferences (tone, response length, priorities, decisions, feedback patterns). Requires 3+ signals before reaching high confidence (no overfitting). Builds a structured preference profile for the chat system.
- **API routes** (routes/preferences.ts): GET /profile, POST /signal, POST /feedback, POST /priority, POST /decision, GET /signals.
- **Chat integration**: Preference profile injected into system prompt so AI adapts tone, length, and structure. Chat interactions automatically record response length signals. Profile includes transparency notes ("strong/moderate signal, N observations").

The system learns from: response lengths, tone feedback, priority actions, decision patterns. Preferences evolve over time with confidence scores.
<!-- SECTION:FINAL_SUMMARY:END -->
