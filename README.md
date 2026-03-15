<p align="center">
  <img src="docs/mascot.svg" alt="Pai mascot" width="160" />
</p>

# Pai - Personal AI Assistant

A desktop AI assistant that lives in your sidebar. Manage tasks, notes, emails, files, reminders, and more — all through natural conversation or direct UI.

## Features

- **AI Chat** — Conversational assistant powered by GitHub Copilot (GPT-4o / Claude / o1)
- **My Day** — Dashboard with today's calendar, tasks, and reminders
- **Notes & Tasks** — Unified Notion-like editor (TipTap) with rich text, checklists, and task tracking
- **Emails** — Outlook integration via COM bridge — search, read, and reply
- **Files** — Scan open documents across Office apps and browser tabs
- **People** — Org chart and contact lookup via Active Directory
- **Reminders** — Set via chat or UI, with desktop notifications and snooze
- **Reading List** — Save links to read later

## Architecture

```
pai/
├── src/              # React frontend (Vite + TypeScript)
│   ├── components/   # UI components (chat, notes, emails, etc.)
│   ├── api/          # API client
│   └── hooks/        # React hooks
├── server/           # Express backend
│   ├── routes/       # API routes
│   └── services/     # Business logic (Copilot, Graph, Outlook)
├── electron/         # Electron shell (sidecar + full mode)
│   ├── main.js       # Main process
│   └── preload.js    # IPC bridge
└── tools/            # Native bridges
    └── outlook-bridge/  # C# COM interop for Outlook
```

## Modes

- **Sidecar** — Slim chat panel docked to screen edge (Ctrl+2 to toggle)
- **Full** — Maximized window with sidebar, content pages, and chat panel

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+2 | Toggle Pai window |
| Alt+F | Toggle sidecar / full mode |
| Esc | Full → sidecar, Sidecar → hide |
| Ctrl+F | Focus search on current page |

## Setup

```bash
npm install
npm run dev        # Start Vite dev server
npx electron .     # Start Electron shell
```

Requires:
- Node.js 18+
- .NET 8 SDK (for Outlook bridge)
- Microsoft 365 account (for email/calendar)
