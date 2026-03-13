require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const { initDb, getDb } = require('./db/database');
const authRoutes = require('./routes/auth');
const boundaryRoutes = require('./routes/boundaries');
const studentRoutes = require('./routes/students');
const settingsRoutes = require('./routes/settings');
const searchRoutes = require('./routes/search');
const sisRoutes = require('./routes/sis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.use('/api/auth', authRoutes);

function requireAuth(req, res, next) {
  const db = getDb();
  const admin = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();

  if (!admin || !admin.value) {
    return next();
  }

  if (req.session && req.session.authenticated) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use('/api/boundaries', boundaryRoutes(upload));
app.use('/api/students', studentRoutes(upload));
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/sis', sisRoutes);

initDb();
app.listen(PORT, () => {
  console.log(`TransferMap running at http://localhost:${PORT}`);
});
