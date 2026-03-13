# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TransferMap is a school district boundary mapping application that determines whether existing and newly enrolling students live inside district boundaries. It uses Node.js/Express with SQLite and Leaflet.js maps.

## Commands

- `npm start` — Run the server (default port 3000)
- `npm run dev` — Run with `--watch` for auto-restart on changes

No test framework is configured yet.

## Architecture

**Backend** (Express):
- `server.js` — Entry point, middleware, route mounting
- `routes/boundaries.js` — CRUD for district boundaries, GeoJSON/Shapefile upload via multer
- `routes/students.js` — CRUD for students, CSV upload, geocoding (Nominatim), point-in-polygon boundary checks (Turf.js)
- `db/database.js` — SQLite setup via better-sqlite3 with WAL mode; tables: `boundaries`, `students`

**Frontend** (vanilla JS, no build step):
- `public/index.html` — Single-page app shell
- `public/app.js` — Map initialization (Leaflet + Leaflet.Draw), API calls, UI state
- `public/style.css` — Styles

**Key data flow**: Student addresses are geocoded via OpenStreetMap Nominatim (rate-limited to 1 req/sec), then checked against boundary polygons using `@turf/turf` `booleanPointInPolygon`.

**File uploads** land in `uploads/` temporarily and are deleted after processing. The SQLite database is stored at `db/transfermap.db`.

## Key Dependencies

- `@turf/turf` — Geospatial point-in-polygon checks
- `shapefile` — Shapefile (.shp) to GeoJSON conversion
- `better-sqlite3` — Synchronous SQLite (uses transactions for bulk operations)
- `csv-parse` — Server-side CSV parsing for student imports
- Leaflet + Leaflet.Draw loaded from CDN (no npm/bundler for frontend)
