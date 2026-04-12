import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = process.env.DATABASE_DIR || path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'PersonalAssistant');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'assistant.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Migrate: add new columns to existing tables if missing
// Migrate: add new columns to existing tables if missing
try { db.exec(`ALTER TABLE Notes ADD COLUMN notebookId INTEGER NOT NULL DEFAULT 1`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN isTask INTEGER NOT NULL DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN taskStatus INTEGER NOT NULL DEFAULT 0`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN dueDate TEXT`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'manual'`); } catch { }
try { db.exec(`ALTER TABLE Notes ADD COLUMN sourceId TEXT`); } catch { }

// One-time migration: move TaskItems into Notes (only if TaskItems table exists and has rows, and no tasks in Notes yet)
try {
  const hasTaskNotes = (db.prepare('SELECT COUNT(*) as c FROM Notes WHERE isTask = 1').get() as any).c;
  if (hasTaskNotes === 0) {
    const tasks = db.prepare('SELECT * FROM TaskItems').all() as any[];
    if (tasks.length > 0) {
      const insert = db.prepare(
        `INSERT INTO Notes (title, content, tags, notebookId, isPinned, isTask, taskStatus, dueDate, sourceType, sourceId, createdAt, updatedAt)
         VALUES (?, ?, '', 1, 0, 1, ?, ?, ?, ?, ?, ?)`
      );
      for (const t of tasks) {
        insert.run(t.title, t.description || '', t.status, t.dueDate, t.sourceType || 'manual', t.sourceId, t.createdAt, t.createdAt);
      }
      console.log(`[DB] Migrated ${tasks.length} tasks into Notes (one-time)`);
    }
  }
} catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiCategory TEXT NOT NULL DEFAULT ''`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiPriority TEXT NOT NULL DEFAULT ''`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiSummary TEXT NOT NULL DEFAULT ''`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiSuggestedAction TEXT NOT NULL DEFAULT ''`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiActionItems TEXT NOT NULL DEFAULT '[]'`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiDeadlines TEXT NOT NULL DEFAULT '[]'`); } catch { }
try { db.exec(`ALTER TABLE ImportantEmails ADD COLUMN aiThreadTopic TEXT NOT NULL DEFAULT ''`); } catch { }

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS Notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'General',
    icon TEXT NOT NULL DEFAULT '',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  INSERT OR IGNORE INTO Notebooks (id, name, icon) VALUES (1, 'General', '');

  CREATE TABLE IF NOT EXISTS Notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notebookId INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    tags TEXT NOT NULL DEFAULT '',
    isPinned INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (notebookId) REFERENCES Notebooks(id)
  );

  CREATE TABLE IF NOT EXISTS Reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    dueAt TEXT NOT NULL,
    isRecurring INTEGER NOT NULL DEFAULT 0,
    recurrenceRule TEXT,
    isDismissed INTEGER NOT NULL DEFAULT 0,
    snoozedUntil TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS ReadingItems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    source TEXT,
    addedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    isRead INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS TaskItems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sourceType TEXT NOT NULL DEFAULT 'manual',
    sourceId TEXT,
    dueDate TEXT,
    status INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS ImportantEmails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graphMessageId TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL DEFAULT '',
    fromName TEXT NOT NULL DEFAULT '',
    fromEmail TEXT NOT NULL DEFAULT '',
    receivedAt TEXT NOT NULL,
    bodyPreview TEXT NOT NULL DEFAULT '',
    isRead INTEGER NOT NULL DEFAULT 0,
    importance TEXT NOT NULL DEFAULT 'normal',
    isActioned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ChatSessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS ChatMessages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (sessionId) REFERENCES ChatSessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notes_created ON Notes(createdAt);
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON Reminders(dueAt);
  CREATE INDEX IF NOT EXISTS idx_reminders_dismissed ON Reminders(isDismissed);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON TaskItems(status);
  CREATE INDEX IF NOT EXISTS idx_emails_received ON ImportantEmails(receivedAt);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON ChatMessages(sessionId);

  CREATE TABLE IF NOT EXISTS AppSettings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ChatMemories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- Memory Graph tables
  CREATE TABLE IF NOT EXISTS MemoryNodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,  -- person, project, topic, task, decision, meeting, file
    name TEXT NOT NULL,
    normalizedName TEXT NOT NULL,  -- lowercase for dedup matching
    attributes TEXT NOT NULL DEFAULT '{}',  -- JSON blob for flexible metadata
    firstSeen TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    lastSeen TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    mentions INTEGER NOT NULL DEFAULT 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_dedup ON MemoryNodes(type, normalizedName);
  CREATE INDEX IF NOT EXISTS idx_memory_nodes_type ON MemoryNodes(type);
  CREATE INDEX IF NOT EXISTS idx_memory_nodes_name ON MemoryNodes(normalizedName);

  CREATE TABLE IF NOT EXISTS MemoryEdges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromNodeId INTEGER NOT NULL,
    toNodeId INTEGER NOT NULL,
    type TEXT NOT NULL,  -- works_on, attended, owns, related_to, mentioned_in, decided, etc.
    weight REAL NOT NULL DEFAULT 1.0,
    attributes TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    lastSeen TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (fromNodeId) REFERENCES MemoryNodes(id) ON DELETE CASCADE,
    FOREIGN KEY (toNodeId) REFERENCES MemoryNodes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON MemoryEdges(fromNodeId);
  CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON MemoryEdges(toNodeId);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_edges_dedup ON MemoryEdges(fromNodeId, toNodeId, type);

  CREATE TABLE IF NOT EXISTS MemoryFacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nodeId INTEGER NOT NULL,
    fact TEXT NOT NULL,
    source TEXT NOT NULL,  -- email, calendar, chat, note, task
    sourceId TEXT,  -- ID in the source system
    sourceDetail TEXT,  -- e.g. email subject, meeting title
    confidence REAL NOT NULL DEFAULT 1.0,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (nodeId) REFERENCES MemoryNodes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memory_facts_node ON MemoryFacts(nodeId);
  CREATE INDEX IF NOT EXISTS idx_memory_facts_time ON MemoryFacts(timestamp);
  CREATE INDEX IF NOT EXISTS idx_memory_facts_source ON MemoryFacts(source);

  -- User Preferences (adaptive learning)
  CREATE TABLE IF NOT EXISTS UserPreferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,  -- tone, style, priorities, decisions
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.0,  -- 0.0 to 1.0, increases with evidence
    evidenceCount INTEGER NOT NULL DEFAULT 0,
    lastEvidence TEXT,  -- description of last signal
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_prefs_key ON UserPreferences(category, key);

  CREATE TABLE IF NOT EXISTS PreferenceSignals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signalType TEXT NOT NULL,  -- edit, feedback, rating, behavior, response_length, response_time
    context TEXT NOT NULL DEFAULT '',  -- what was happening
    value TEXT NOT NULL DEFAULT '',  -- the signal value
    metadata TEXT NOT NULL DEFAULT '{}',  -- JSON extra data
    createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_pref_signals_type ON PreferenceSignals(signalType);
  CREATE INDEX IF NOT EXISTS idx_pref_signals_time ON PreferenceSignals(createdAt);
`);

export default db;
