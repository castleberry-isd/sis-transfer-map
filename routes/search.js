const express = require('express');
const turf = require('@turf/turf');
const { getDb } = require('../db/database');

const router = express.Router();

const SEARCH_CENTER = '-97.3964,32.7815';
const SEARCH_DISTANCE = 32187;
const SEARCH_COUNTRY = 'US';

// Return address autocomplete suggestions from ArcGIS
router.get('/suggest', async (req, res) => {
  const { text } = req.query;
  if (!text || text.length < 3) {
    return res.json([]);
  }

  const db = getDb();
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();

  const params = new URLSearchParams({
    text,
    f: 'json',
    maxSuggestions: 6,
    location: SEARCH_CENTER,
    distance: SEARCH_DISTANCE,
    countryCode: SEARCH_COUNTRY,
  });

  if (apiKey?.value) {
    params.append('token', apiKey.value);
  }

  try {
    const response = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?${params}`);
    const data = await response.json();
    res.json(data.suggestions || []);
  } catch (err) {
    console.error('Suggest error:', err);
    res.json([]);
  }
});

// Geocode a selected suggestion and check if it falls within district boundaries
router.get('/find', async (req, res) => {
  const { text, magicKey } = req.query;

  const db = getDb();
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'arcgis_api_key'").get();

  const params = new URLSearchParams({
    SingleLine: text,
    f: 'json',
    outFields: '*',
    maxLocations: 1,
    location: SEARCH_CENTER,
    distance: SEARCH_DISTANCE,
    countryCode: SEARCH_COUNTRY,
  });

  if (magicKey) {
    params.append('magicKey', magicKey);
  }
  if (apiKey?.value) {
    params.append('token', apiKey.value);
  }

  try {
    const response = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params}`);
    const data = await response.json();

    if (data.candidates && data.candidates.length > 0) {
      const best = data.candidates[0];
      const lat = best.location.y;
      const lon = best.location.x;

      const boundaries = db.prepare('SELECT geojson FROM boundaries').all();
      const point = turf.point([lon, lat]);
      let inDistrict = false;

      for (const b of boundaries) {
        const geojson = JSON.parse(b.geojson);
        for (const feature of geojson.features) {
          if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
            if (turf.booleanPointInPolygon(point, feature)) {
              inDistrict = true;
              break;
            }
          }
        }
        if (inDistrict) break;
      }

      res.json({
        address: best.address,
        latitude: lat,
        longitude: lon,
        score: best.score,
        inDistrict,
      });
    } else {
      res.json(null);
    }
  } catch (err) {
    console.error('Find error:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

module.exports = router;
