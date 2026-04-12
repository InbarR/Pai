import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

import notesRouter from './routes/notes';
import remindersRouter from './routes/reminders';
import readingRouter from './routes/reading';
import tasksRouter from './routes/tasks';
import emailsRouter from './routes/emails';
import dashboardRouter from './routes/dashboard';
import authRouter from './routes/auth';
import chatRouter from './routes/chat';
import chatSessionsRouter from './routes/chat-sessions';
import calendarRouter from './routes/calendar';
import filesRouter from './routes/files';
import peopleRouter from './routes/people';
import memoryRouter from './routes/memory';
import preferencesRouter from './routes/preferences';
import notificationRouter, { broadcast } from './services/notification-sse';
import { startReminderScheduler } from './services/reminder-scheduler';

// Import db to ensure tables are created
import './db';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors({ origin: ['http://localhost:5179', 'http://localhost:5173'], credentials: true }));
app.use(express.json({ limit: '20mb' }));

// API routes
app.use('/api/notes', notesRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/reading', readingRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/chat/sessions', chatSessionsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/files', filesRouter);
app.use('/api/people', peopleRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/preferences', preferencesRouter);

// Serve React build in production
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  startReminderScheduler();
  // Pre-warm Copilot token so first chat request is fast
  import('./services/copilot').then(c => c.isAuthenticated() && c.chatCompletion([{ role: 'user', content: 'ping' }], 'gpt-4o').catch(() => {}));
  // Auto-sync emails on startup (background)
  setTimeout(() => {
    import('./services/graph').then(g => g.syncEmails().then(n => n > 0 && console.log(`[Startup] Synced ${n} new emails`)).catch(() => {}));
  }, 8000);
});
