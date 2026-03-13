const express = require('express');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const turf = require('@turf/turf');
const { getDb } = require('../db/database');

const BATCH_SIZE = 150;
const TRANSFER_CODES = ['3', '6'];

// Geocode a single address via ArcGIS
async function geocodeAddress(address, apiKey) {
  const encoded = encodeURIComponent(address);
  const base = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
  let url = `${base}?SingleLine=${encoded}&f=json&outFields=*&maxLocations=1`;

  if (apiKey) {
    url += `&token=${apiKey}`;
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || 'Geocoding API error');
  }

  if (!data.candidates || data.candidates.length === 0) {
    return null;
  }

  const best = data.candidates[0];
  return {
    latitude: best.location.y,
    longitude: best.location.x,
    score: best.score,
    matchAddr: best.attributes?.Match_addr || best.address,
  };
}

// Geocode a batch of students via ArcGIS batch endpoint
async function geocodeAddressBatch(studentBatch, apiKey) {
  const records = studentBatch.map((s, i) => ({
    attributes: {
      OBJECTID: i,
      SingleLine: s.address,
    },
  }));

  const base = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/geocodeAddresses';
  const body = new URLSearchParams({
    addresses: JSON.stringify({ records }),
    f: 'json',
    outFields: '*',
  });

  if (apiKey) {
    body.append('token', apiKey);
  }

  const response = await fetch(base, { method: 'POST', body });
  const data = await response.json();

  if (data.error) {
    console.error('ArcGIS batch error response:', JSON.stringify(data.error));
    throw new Error(data.error.message || 'Batch geocoding API error');
  }

  if (studentBatch[0] && !geocodeAddressBatch._logged) {
    geocodeAddressBatch._logged = true;
    console.log('ArcGIS batch response keys:', Object.keys(data));
    console.log('ArcGIS locations count:', (data.locations || []).length);
    if (data.locations && data.locations[0]) {
      console.log('ArcGIS first location:', JSON.stringify(data.locations[0]));
    }
  }

  const results = new Map();
  for (const loc of (data.locations || [])) {
    const oid = loc.attributes?.ResultID ?? loc.attributes?.OBJECTID;
    if (loc.location) {
      results.set(oid, {
        latitude: loc.location.y,
        longitude: loc.location.x,
        score: loc.score || loc.attributes?.Score,
      });
    }
  }

  return results;
}

// Check all geocoded students against boundary polygons and flag exceptions
function checkBoundaries() {
  const db = getDb();
  const boundaries = db.prepare('SELECT * FROM boundaries').all();
  const students = db.prepare('SELECT * FROM students WHERE latitude IS NOT NULL AND longitude IS NOT NULL').all();

  if (boundaries.length === 0) return { inDistrict: 0, outOfDistrict: 0, exceptions: 0 };

  const updateStmt = db.prepare('UPDATE students SET in_district = ?, boundary_id = ?, exception = ? WHERE id = ?');

  const checkAll = db.transaction(() => {
    let inDistrict = 0;
    let outOfDistrict = 0;
    let exceptions = 0;

    for (const student of students) {
      const point = turf.point([student.longitude, student.latitude]);
      let found = false;

      for (const boundary of boundaries) {
        const geojson = JSON.parse(boundary.geojson);
        for (const feature of geojson.features) {
          if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
            if (turf.booleanPointInPolygon(point, feature)) {
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }

      const isTransferCode = TRANSFER_CODES.includes(String(student.entry_code).trim());
      const isException = (found && isTransferCode) || (!found && !isTransferCode && student.entry_code);

      if (found) {
        updateStmt.run(1, null, isException ? 1 : 0, student.id);
        inDistrict++;
      } else {
        updateStmt.run(0, null, isException ? 1 : 0, student.id);
        outOfDistrict++;
      }

      if (isException) exceptions++;
    }

    return { inDistrict, outOfDistrict, exceptions };
  });

  return checkAll();
}

module.exports = function (upload) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM students ORDER BY last_name, first_name').all();
    res.json(rows);
  });

  // Add a single student, auto-geocode and check boundaries
  router.post('/', async (req, res) => {
    const { student_id, first_name, last_name, address, latitude, longitude, enrollment_status, entry_code } = req.body;
    if (!first_name || !last_name || !address) {
      return res.status(400).json({ error: 'first_name, last_name, and address are required' });
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO students (student_id, first_name, last_name, address, latitude, longitude, enrollment_status, entry_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      student_id || null,
      first_name,
      last_name,
      address,
      latitude || null,
      longitude || null,
      enrollment_status || 'existing',
      entry_code || null
    );

    const studentId = result.lastInsertRowid;

    if (!latitude || !longitude) {
      try {
        const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();
        const geo = await geocodeAddress(address, apiKey?.value);
        if (geo) {
          db.prepare('UPDATE students SET latitude = ?, longitude = ?, geocoded_address = ? WHERE id = ?').run(geo.latitude, geo.longitude, address, studentId);
        }
      } catch {}
    }

    checkBoundaries();

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    res.json(student);
  });

  // Import students from a CSV file
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const raw = fs.readFileSync(file.path, 'utf-8');
      const records = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const db = getDb();

      const upsertStmt = db.prepare(`
        INSERT INTO students (student_id, first_name, last_name, address, enrollment_status, entry_code)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          address = excluded.address,
          enrollment_status = excluded.enrollment_status,
          entry_code = excluded.entry_code
      `);

      const insertStmt = db.prepare(`
        INSERT INTO students (student_id, first_name, last_name, address, latitude, longitude, enrollment_status, entry_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((students) => {
        let count = 0;
        for (const s of students) {
          const firstName = s.first_name || s.FirstName || s['First Name'] || '';
          const lastName = s.last_name || s.LastName || s['Last Name'] || '';
          const address = s.address || s.Address || '';
          const studentId = s.student_id || s.StudentId || s['Student ID'] || s.ID || null;
          const lat = parseFloat(s.latitude || s.Latitude || s.lat) || null;
          const lng = parseFloat(s.longitude || s.Longitude || s.lng || s.lon) || null;
          const status = s.enrollment_status || s.status || 'existing';
          const entryCode = s.entry_code || s.EntryCode || s['Entry Code'] || s.entry_cd || null;

          if (firstName && lastName && address) {
            if (studentId) {
              upsertStmt.run(studentId, firstName, lastName, address, status, entryCode);
            } else {
              insertStmt.run(null, firstName, lastName, address, lat, lng, status, entryCode);
            }
            count++;
          }
        }
        return count;
      });

      const count = insertMany(records);
      fs.unlinkSync(file.path);

      res.json({ imported: count, total: records.length });
    } catch (err) {
      console.error('CSV upload error:', err);
      res.status(500).json({ error: 'Failed to process CSV file' });
    }
  });

  // SSE pipeline: geocode ungeocoded students, then run boundary checks
  router.get('/process-all', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const db = getDb();
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();

    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
    const toGeocode = db.prepare('SELECT * FROM students WHERE latitude IS NULL OR longitude IS NULL OR address != COALESCE(geocoded_address, \'\')').all();
    const skipped = totalStudents - toGeocode.length;
    const total = toGeocode.length;
    let geocoded = 0;
    let failed = 0;
    let processed = 0;

    if (skipped > 0) {
      res.write(`data: ${JSON.stringify({ step: 'info', message: `Skipping ${skipped} students with unchanged addresses` })}\n\n`);
    }

    if (total > 0) {
      res.write(`data: ${JSON.stringify({ step: 'geocoding', current: 0, total, geocoded: 0, failed: 0 })}\n\n`);

      for (let batchStart = 0; batchStart < toGeocode.length; batchStart += BATCH_SIZE) {
        const batch = toGeocode.slice(batchStart, batchStart + BATCH_SIZE);

        try {
          const results = await geocodeAddressBatch(batch, apiKey?.value);

          for (let i = 0; i < batch.length; i++) {
            const student = batch[i];
            const result = results.get(i);

            if (result && result.score > 0) {
              db.prepare('UPDATE students SET latitude = ?, longitude = ?, geocoded_address = ? WHERE id = ?').run(result.latitude, result.longitude, student.address, student.id);
              geocoded++;
            } else {
              failed++;
            }
            processed++;
          }
        } catch (err) {
          console.error('Batch geocode error:', err.message || err);
          failed += batch.length;
          processed += batch.length;
        }

        res.write(`data: ${JSON.stringify({ step: 'geocoding', current: processed, total, geocoded, failed, batch: `${Math.floor(batchStart / BATCH_SIZE) + 1} of ${Math.ceil(total / BATCH_SIZE)}` })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ step: 'checking', message: 'Checking boundaries and flagging exceptions...' })}\n\n`);
    const boundaryResult = checkBoundaries();

    res.write(`data: ${JSON.stringify({ done: true, geocoded, failed, totalGeocoded: total, ...boundaryResult })}\n\n`);
    res.end();
  });

  // Run boundary checks without geocoding
  router.post('/check-boundaries', (req, res) => {
    const db = getDb();
    const boundaries = db.prepare('SELECT * FROM boundaries').all();
    if (boundaries.length === 0) {
      return res.status(400).json({ error: 'No boundaries defined' });
    }

    const result = checkBoundaries();
    const notGeocoded = db.prepare('SELECT COUNT(*) as count FROM students WHERE latitude IS NULL OR longitude IS NULL').get();
    res.json({ ...result, notGeocoded: notGeocoded.count });
  });

  // Geocode a single student by ID
  router.post('/:id/geocode', async (req, res) => {
    const db = getDb();
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    try {
      const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();
      const result = await geocodeAddress(student.address, apiKey?.value);

      if (!result) {
        return res.status(404).json({ error: 'Address not found' });
      }

      db.prepare('UPDATE students SET latitude = ?, longitude = ?, geocoded_address = ? WHERE id = ?').run(result.latitude, result.longitude, student.address, student.id);
      checkBoundaries();

      res.json(result);
    } catch (err) {
      console.error('Geocoding error:', err);
      res.status(500).json({ error: 'Geocoding failed: ' + err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  router.delete('/', (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM students').run();
    res.json({ success: true });
  });

  return router;
};
