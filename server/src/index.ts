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
import notificationRouter, { broadcast } from './services/notification-sse';
import { startReminderScheduler } from './services/reminder-scheduler';

// Import db to ensure tables are created
import './db';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors({ origin: ['http://localhost:5179', 'http://localhost:5173'], credentials: true }));
app.use(express.json());

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
});
