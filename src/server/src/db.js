const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = process.env.OUTPUT_DIR || '/data';
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const db = new Database(path.join(OUTPUT_DIR, 'webwalk.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS walks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Untitled Walk',
    duration_seconds INTEGER NOT NULL DEFAULT 60,
    status TEXT NOT NULL DEFAULT 'draft',
    total_frames INTEGER NOT NULL DEFAULT 0,
    downloaded_frames INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS walk_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    UNIQUE(walk_id, sort_order)
  );
`);

// Prepared statements
const stmts = {
  insertWalk: db.prepare(`
    INSERT INTO walks (id, name, duration_seconds, status)
    VALUES (@id, @name, @duration_seconds, 'draft')
  `),
  updateWalk: db.prepare(`
    UPDATE walks SET name = @name, duration_seconds = @duration_seconds, updated_at = datetime('now')
    WHERE id = @id
  `),
  updateWalkStatus: db.prepare(`
    UPDATE walks SET status = @status, total_frames = @total_frames,
    downloaded_frames = @downloaded_frames, error_message = @error_message,
    updated_at = datetime('now')
    WHERE id = @id
  `),
  getWalk: db.prepare('SELECT * FROM walks WHERE id = ?'),
  listWalks: db.prepare('SELECT * FROM walks ORDER BY created_at DESC'),
  deleteWalk: db.prepare('DELETE FROM walks WHERE id = ?'),

  insertPoint: db.prepare(`
    INSERT INTO walk_points (walk_id, sort_order, lat, lng)
    VALUES (@walk_id, @sort_order, @lat, @lng)
  `),
  deletePoints: db.prepare('DELETE FROM walk_points WHERE walk_id = ?'),
  getPoints: db.prepare('SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order'),
};

module.exports = { db, stmts };
