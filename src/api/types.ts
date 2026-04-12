export interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string;
  notebookId: number;
  isPinned: number;
  isTask: number;
  taskStatus: number; // 0=Todo, 1=InProgress, 2=Done
  dueDate: string | null;
  sourceType: string;
  sourceId: string | null;
}

export interface Reminder {
  id: number;
  title: string;
  description: string;
  dueAt: string;
  isRecurring: number;
  recurrenceRule: string | null;
  isDismissed: number;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface ReadingItem {
  id: number;
  title: string;
  url: string;
  source: string | null;
  addedAt: string;
  isRead: number;
  priority: number;
}

export enum TaskStatus {
  Todo = 0,
  InProgress = 1,
  Done = 2,
}

export interface TaskItem {
  id: number;
  title: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  dueDate: string | null;
  status: TaskStatus;
  createdAt: string;
}

export interface ImportantEmail {
  id: number;
  graphMessageId: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  receivedAt: string;
  bodyPreview: string;
  isRead: number;
  importance: string;
  isActioned: number;
}

export interface CalendarEvent {
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  isOnline: boolean;
  joinUrl: string;
}

export interface DashboardData {
  activeReminderCount: number;
  nextReminder: Reminder | null;
  unreadReadingCount: number;
  openTaskCount: number;
  inProgressTaskCount: number;
  unreadEmailCount: number;
  noteCount: number;
  upcomingReminders: Reminder[];
  recentTasks: TaskItem[];
  recentEmails: ImportantEmail[];
  todayMeetings: CalendarEvent[];
}
