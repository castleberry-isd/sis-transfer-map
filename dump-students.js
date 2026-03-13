const { initDb, getDb } = require('./db/database');
const fs = require('fs');

initDb();
const db = getDb();
const rows = db.prepare('SELECT * FROM students').all();

if (rows.length === 0) {
  console.log('No students in database');
  process.exit(0);
}

const cols = Object.keys(rows[0]);
const csv = [cols.join(',')];
for (const row of rows) {
  csv.push(cols.map(c => {
    const val = row[c] == null ? '' : String(row[c]);
    return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
  }).join(','));
}

fs.writeFileSync('students-dump.csv', csv.join('\n'));
console.log(`Wrote ${rows.length} students to students-dump.csv`);
