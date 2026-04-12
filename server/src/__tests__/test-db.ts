/**
 * Test database helper.
 * Replaces the real db module with an in-memory SQLite database.
 */
import Database from 'better-sqlite3';
import { vi } from 'vitest';

let testDb: Database.Database;

// Global reference accessible from vi.mock proxy
(globalThis as any).__testDb = null;

export function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  testDb.exec(`
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
      isTask INTEGER NOT NULL DEFAULT 0,
      taskStatus INTEGER NOT NULL DEFAULT 0,
      dueDate TEXT,
      sourceType TEXT NOT NULL DEFAULT 'manual',
      sourceId TEXT,
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
      isActioned INTEGER NOT NULL DEFAULT 0,
      aiCategory TEXT NOT NULL DEFAULT '',
      aiPriority TEXT NOT NULL DEFAULT '',
      aiSummary TEXT NOT NULL DEFAULT '',
      aiSuggestedAction TEXT NOT NULL DEFAULT '',
      aiActionItems TEXT NOT NULL DEFAULT '[]',
      aiDeadlines TEXT NOT NULL DEFAULT '[]',
      aiThreadTopic TEXT NOT NULL DEFAULT ''
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

    CREATE TABLE IF NOT EXISTS ReadingItems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      source TEXT,
      addedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      isRead INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS MemoryNodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      normalizedName TEXT NOT NULL,
      attributes TEXT NOT NULL DEFAULT '{}',
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
      type TEXT NOT NULL,
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
      source TEXT NOT NULL,
      sourceId TEXT,
      sourceDetail TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (nodeId) REFERENCES MemoryNodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_node ON MemoryFacts(nodeId);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_time ON MemoryFacts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_source ON MemoryFacts(source);

    CREATE TABLE IF NOT EXISTS UserPreferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.0,
      evidenceCount INTEGER NOT NULL DEFAULT 0,
      lastEvidence TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_prefs_key ON UserPreferences(category, key);

    CREATE TABLE IF NOT EXISTS PreferenceSignals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signalType TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_pref_signals_type ON PreferenceSignals(signalType);
    CREATE INDEX IF NOT EXISTS idx_pref_signals_time ON PreferenceSignals(createdAt);
  `);

  (globalThis as any).__testDb = testDb;
  return testDb;
}

export function teardownTestDb() {
  if (testDb && testDb.open) {
    testDb.close();
  }
  vi.resetModules();
}

export function getTestDb() {
  return testDb;
}
