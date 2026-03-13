const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'transfermap.db');
let db;

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS boundaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      geojson TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      in_district INTEGER,
      boundary_id INTEGER,
      enrollment_status TEXT DEFAULT 'existing',
      entry_code TEXT,
      exception INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (boundary_id) REFERENCES boundaries(id)
    );
  `);

  try { db.exec('ALTER TABLE students ADD COLUMN entry_code TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN exception INTEGER'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN geocoded_address TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN grad_year TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN student_grade TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN campus TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN guardian_name TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN guardian_email TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN guardian_phone TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN res_district TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN res_dist_desc TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN entry_desc TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN spec_ed_status TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN pri_dis_code TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN pri_dis_desc TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN homeroom_tchr TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN homeroom_number TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN eth_race_desc TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN gender TEXT'); } catch {}
  try { db.exec('ALTER TABLE students ADD COLUMN arcgis_display TEXT'); } catch {}

  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id)'); } catch {}

  try {
    db.exec(`
      DELETE FROM students WHERE id NOT IN (
        SELECT MAX(id) FROM students GROUP BY student_id
      ) AND student_id IS NOT NULL
    `);
  } catch {}

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = { initDb, getDb };
