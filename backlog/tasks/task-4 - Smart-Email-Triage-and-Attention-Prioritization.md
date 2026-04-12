---
id: TASK-4
title: Smart Email Triage and Attention Prioritization
status: Done
assignee:
  - '@claude'
created_date: '2026-03-21 09:27'
updated_date: '2026-03-21 09:43'
labels:
  - ai
  - email
  - triage
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build an AI assistant that analyzes the user's emails and highlights what requires attention. Classifies emails by importance and urgency, detects action items (explicit and implicit), identifies deadlines and risks, and groups related threads into topics or projects. Outputs a prioritized list with reasoning, required actions, and optional suggested responses. Provides a daily 'what matters today' summary and flags missed or overdue commitments. Focus on precision over recall — fewer high-quality items over noisy lists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Classify emails by importance and urgency
- [x] #2 Detect action items explicitly and implicitly stated in emails
- [x] #3 Identify deadlines and risks from email content
- [x] #4 Group related email threads into topics or projects
- [x] #5 Output prioritized list with: why it matters, required action (reply/schedule/follow-up/ignore), optional suggested response
- [x] #6 Provide a daily 'what matters today' summary
- [x] #7 Flag missed or overdue commitments
- [x] #8 Prefer precision over recall — focus only on meaningful, actionable items
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add new columns to ImportantEmails: aiActionItems (JSON), aiDeadlines (JSON), aiThreadTopic
2. Enhance triageNewEmails to extract action items, deadlines, risks, and thread topics
3. Create a smart triage service (services/email-triage.ts) with:
   a. groupByThread() — group emails by inferred topic/project
   b. getAttentionItems() — prioritized list with why-it-matters and required action
   c. getDailySummary() — "what matters today" digest
   d. getOverdueCommitments() — flag missed deadlines
4. Add new API endpoints: GET /emails/attention, GET /emails/daily-summary, GET /emails/threads
5. Add daily_summary chat ACTION so AI can surface the email digest
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Enhanced email triage with smart attention prioritization.

Changes:
- **Database** (db.ts): Added aiActionItems, aiDeadlines, aiThreadTopic columns to ImportantEmails.
- **Enhanced triage prompt** (emails.ts): AI now extracts action items (explicit + implicit), deadlines, and thread topics alongside category/priority/summary.
- **Email triage service** (services/email-triage.ts): getAttentionItems() — prioritized list with why-it-matters reasoning and required actions. groupByThread() — groups emails by inferred topic/project. getDailySummary() — daily digest with urgent items, action required, today deadlines, overdue commitments, top threads, and stats.
- **API endpoints**: GET /emails/attention, /emails/threads, /emails/daily-summary.
- **Chat integration**: Added email_attention and email_daily_summary ACTION types so AI can surface email intelligence when user asks "what matters today?" or "any important emails?"
<!-- SECTION:FINAL_SUMMARY:END -->
