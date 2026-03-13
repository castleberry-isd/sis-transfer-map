const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

// Check if an ArcGIS API key is configured
router.get('/arcgis-status', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();
  res.json({ hasApiKey: !!(row && row.value) });
});

// Save or clear the ArcGIS API key
router.post('/arcgis-key', (req, res) => {
  const { apiKey } = req.body;
  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('arcgis_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(apiKey || '', apiKey || '');
  res.json({ success: true, hasApiKey: !!apiKey });
});

module.exports = router;
