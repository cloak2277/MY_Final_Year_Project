// Database layer — Node's built-in SQLite (real SQL, no native build step).
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, CURRENT_TERM } from './config.js';

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Schema. Roles are constrained at the DB level. Times are stored as minutes
// from midnight + a day-of-week index (0=Mon..4=Fri) so overlap maths is integer-only.
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK (role IN ('admin','lecturer','student')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      building   TEXT,
      capacity   INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- lecturer_id is the LEAD lecturer; extra teachers live in course_co_lecturers.
    -- level = 100..400, status = C (compulsory) / E (elective), alias = cross-listed code.
    CREATE TABLE IF NOT EXISTS courses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT    NOT NULL UNIQUE,
      alias        TEXT,
      title        TEXT    NOT NULL,
      department   TEXT,
      level        INTEGER CHECK (level IS NULL OR level BETWEEN 100 AND 800),
      status       TEXT    NOT NULL DEFAULT 'C' CHECK (status IN ('C','E')),
      credit_units INTEGER NOT NULL DEFAULT 3 CHECK (credit_units > 0),
      lecturer_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_co_lecturers (
      course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lecturer_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      PRIMARY KEY (course_id, lecturer_id)
    );

    -- A scheduled class meeting (the "booking"). A course may have several.
    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      room_id      INTEGER NOT NULL REFERENCES rooms(id)   ON DELETE CASCADE,
      day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
      start_min    INTEGER NOT NULL CHECK (start_min >= 0),
      duration_min INTEGER NOT NULL CHECK (duration_min > 0),
      term         TEXT    NOT NULL DEFAULT '${CURRENT_TERM}',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Each lecturer of a course confirms (or declines) each of its sessions.
    -- No row = still pending.
    CREATE TABLE IF NOT EXISTS session_confirmations (
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      lecturer_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      status      TEXT    NOT NULL CHECK (status IN ('confirmed','declined')),
      note        TEXT,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, lecturer_id)
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, course_id)
    );

    -- Windows where a lecturer is NOT available to teach.
    CREATE TABLE IF NOT EXISTS availability (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      lecturer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
      start_min   INTEGER NOT NULL,
      end_min     INTEGER NOT NULL,
      CHECK (end_min > start_min)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action     TEXT    NOT NULL,
      detail     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(course_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_room   ON sessions(room_id);
    CREATE INDEX IF NOT EXISTS idx_enroll_student  ON enrollments(student_id);
    CREATE INDEX IF NOT EXISTS idx_enroll_course   ON enrollments(course_id);
    CREATE INDEX IF NOT EXISTS idx_conf_session    ON session_confirmations(session_id);
  `);
  migrate();
}

// Upgrade a database created by an earlier version (adds columns that older files lack).
function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  const courseCols = cols('courses');
  if (!courseCols.includes('alias'))  db.exec('ALTER TABLE courses ADD COLUMN alias TEXT');
  if (!courseCols.includes('level'))  db.exec('ALTER TABLE courses ADD COLUMN level INTEGER');
  if (!courseCols.includes('status')) db.exec("ALTER TABLE courses ADD COLUMN status TEXT NOT NULL DEFAULT 'C'");
}

// Run several statements atomically (handlers are synchronous, so no interleaving).
export function tx(fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function audit(userId, action, detail = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)')
    .run(userId ?? null, action, detail);
}
