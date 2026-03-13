const express = require('express');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const shapefile = require('shapefile');
const { getDb } = require('../db/database');

// Read a .shp/.dbf pair into a GeoJSON FeatureCollection
async function readShapefile(shpPath, dbfPath) {
  const source = await shapefile.open(shpPath, dbfPath);
  const features = [];
  let result;
  while (!(result = await source.read()).done) {
    features.push(result.value);
  }
  return { type: 'FeatureCollection', features };
}

module.exports = function (upload) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT id, name, geojson, created_at FROM boundaries').all();
    const boundaries = rows.map((r) => ({
      ...r,
      geojson: JSON.parse(r.geojson),
    }));
    res.json(boundaries);
  });

  router.post('/', (req, res) => {
    const { name, geojson } = req.body;
    if (!name || !geojson) {
      return res.status(400).json({ error: 'Name and geojson are required' });
    }

    const db = getDb();
    const stmt = db.prepare('INSERT INTO boundaries (name, geojson) VALUES (?, ?)');
    const result = stmt.run(name, JSON.stringify(geojson));

    res.json({ id: result.lastInsertRowid, name });
  });

  // Upload a boundary file (GeoJSON, Shapefile, or zipped shapefile)
  router.post('/upload', upload.single('file'), async (req, res) => {
    const cleanupFiles = [];
    try {
      const name = req.body.name || 'Uploaded Boundary';
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      cleanupFiles.push(file.path);
      const ext = path.extname(file.originalname).toLowerCase();
      let geojson;

      if (ext === '.geojson' || ext === '.json') {
        const raw = fs.readFileSync(file.path, 'utf-8');
        geojson = JSON.parse(raw);

      } else if (ext === '.zip') {
        const zip = new AdmZip(file.path);
        const tmpDir = file.path + '_extracted';
        zip.extractAllTo(tmpDir, true);
        cleanupFiles.push(tmpDir);

        const allFiles = getAllFiles(tmpDir);
        const shpFile = allFiles.find((f) => f.toLowerCase().endsWith('.shp'));
        if (!shpFile) {
          return res.status(400).json({ error: 'No .shp file found inside the zip archive' });
        }

        const dbfFile = allFiles.find((f) => f.toLowerCase().endsWith('.dbf'));
        geojson = await readShapefile(shpFile, dbfFile || undefined);

      } else if (ext === '.shp') {
        const shpPath = file.path + '.shp';
        fs.renameSync(file.path, shpPath);
        cleanupFiles[0] = shpPath;
        geojson = await readShapefile(shpPath);

      } else {
        return res.status(400).json({ error: 'Unsupported file type. Use .geojson, .json, .shp, or .zip (zipped shapefile)' });
      }

      if (geojson.type === 'Feature') {
        geojson = { type: 'FeatureCollection', features: [geojson] };
      } else if (geojson.type !== 'FeatureCollection') {
        geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
      }

      const db = getDb();
      const stmt = db.prepare('INSERT INTO boundaries (name, geojson) VALUES (?, ?)');
      const result = stmt.run(name, JSON.stringify(geojson));

      res.json({ id: result.lastInsertRowid, name, featureCount: geojson.features.length });
    } catch (err) {
      console.error('Boundary upload error:', err);
      res.status(500).json({ error: 'Failed to process boundary file: ' + err.message });
    } finally {
      for (const f of cleanupFiles) {
        try {
          if (fs.existsSync(f)) {
            if (fs.statSync(f).isDirectory()) {
              fs.rmSync(f, { recursive: true });
            } else {
              fs.unlinkSync(f);
            }
          }
        } catch {}
      }
    }
  });

  router.delete('/:id', (req, res) => {
    const db = getDb();
    db.prepare('UPDATE students SET boundary_id = NULL, in_district = NULL WHERE boundary_id = ?').run(req.params.id);
    db.prepare('DELETE FROM boundaries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  return router;
};

// Recursively list all files in a directory
function getAllFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
