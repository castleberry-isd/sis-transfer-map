const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');

const router = express.Router();

// Check authentication status
router.get('/status', (req, res) => {
  const db = getDb();
  const admin = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  res.json({
    passwordSet: !!(admin && admin.value),
    authenticated: !!(req.session && req.session.authenticated),
  });
});

// First-time password setup
router.post('/setup', async (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  if (existing && existing.value) {
    return res.status(400).json({ error: 'Password already set. Use the change-password endpoint.' });
  }

  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(hash, hash);
  req.session.authenticated = true;
  res.json({ success: true });
});

// Login
router.post('/login', async (req, res) => {
  const db = getDb();
  const admin = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();

  if (!admin || !admin.value) {
    return res.status(400).json({ error: 'No password set. Use setup first.' });
  }

  const { password } = req.body;
  const match = await bcrypt.compare(password, admin.value);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  req.session.authenticated = true;
  res.json({ success: true });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Change password
router.post('/change-password', async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }

  const db = getDb();
  const admin = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();

  const match = await bcrypt.compare(currentPassword, admin.value);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password'").run(hash);
  res.json({ success: true });
});

module.exports = router;
