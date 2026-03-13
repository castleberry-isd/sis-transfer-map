const map = L.map('map').setView([32.7815, -97.3964], 12);

map.createPane('exceptionPane');
map.getPane('exceptionPane').style.zIndex = 650;

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
  maxZoom: 20,
  maxNativeZoom: 16,
}).addTo(map);

const boundaryLayer = L.featureGroup().addTo(map);
const studentLayer = L.featureGroup().addTo(map);

const drawnItems = new L.FeatureGroup().addTo(map);
const drawControl = new L.Control.Draw({
  draw: {
    polygon: true,
    polyline: false,
    rectangle: true,
    circle: false,
    circlemarker: false,
    marker: false,
  },
  edit: {
    featureGroup: drawnItems,
  },
});

let drawingMode = false;
let pendingGeojson = null;

const searchInput = document.getElementById('address-search');
const suggestionsEl = document.getElementById('search-suggestions');
let searchTimeout = null;
let activeIndex = -1;
let searchMarker = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const text = searchInput.value.trim();
  if (text.length < 3) {
    suggestionsEl.classList.add('hidden');
    return;
  }
  searchTimeout = setTimeout(() => fetchSuggestions(text), 250);
});

async function fetchSuggestions(text) {
  const res = await fetch(`/api/search/suggest?text=${encodeURIComponent(text)}`);
  const suggestions = await res.json();

  if (suggestions.length === 0) {
    suggestionsEl.classList.add('hidden');
    return;
  }

  activeIndex = -1;
  suggestionsEl.innerHTML = suggestions.map((s, i) =>
    `<div class="suggestion-item" data-index="${i}" data-text="${s.text}" data-key="${s.magicKey}">${s.text}</div>`
  ).join('');
  suggestionsEl.classList.remove('hidden');
}

suggestionsEl.addEventListener('click', (e) => {
  const item = e.target.closest('.suggestion-item');
  if (item) selectSuggestion(item.dataset.text, item.dataset.key);
});

searchInput.addEventListener('keydown', (e) => {
  const items = suggestionsEl.querySelectorAll('.suggestion-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex >= 0 && items[activeIndex]) {
      selectSuggestion(items[activeIndex].dataset.text, items[activeIndex].dataset.key);
    }
  } else if (e.key === 'Escape') {
    suggestionsEl.classList.add('hidden');
  }
});

function updateActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
}

async function selectSuggestion(text, magicKey) {
  searchInput.value = text;
  suggestionsEl.classList.add('hidden');

  const res = await fetch(`/api/search/find?text=${encodeURIComponent(text)}&magicKey=${encodeURIComponent(magicKey)}`);
  const result = await res.json();

  if (result && result.latitude) {
    if (searchMarker) map.removeLayer(searchMarker);

    const pinClass = result.inDistrict ? 'search-marker-in' : 'search-marker-out';
    const statusText = result.inDistrict ? 'IN DISTRICT' : 'OUTSIDE DISTRICT';
    const statusColor = result.inDistrict ? '#059669' : '#dc2626';

    searchMarker = L.marker([result.latitude, result.longitude], {
      icon: L.divIcon({
        className: 'search-marker',
        html: `<div class="search-marker-pin ${pinClass}"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(map);

    searchMarker.bindPopup(`
      <strong>${result.address}</strong><br>
      <span style="color:${statusColor}; font-weight:700; font-size:1.05em;">${statusText}</span>
    `).openPopup();
    map.setView([result.latitude, result.longitude], 16);
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    suggestionsEl.classList.add('hidden');
  }
});

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

async function loadBoundaries() {
  const boundaries = await api('/api/boundaries');
  boundaryLayer.clearLayers();
  const listEl = document.getElementById('boundary-list');
  listEl.innerHTML = '';

  boundaries.forEach((b) => {
    const layer = L.geoJSON(b.geojson, {
      style: {
        color: '#1a56db',
        weight: 3,
        fillOpacity: 0.08,
      },
    }).addTo(boundaryLayer);

    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="detail">${b.geojson.features ? b.geojson.features.length : 0} feature(s)</div>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-primary" onclick="zoomToBoundary(${b.id})">Zoom</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBoundary(${b.id})">Delete</button>
      </div>
    `;
    listEl.appendChild(card);

    layer._boundaryId = b.id;
  });
}

async function zoomToBoundary(id) {
  document.getElementById('settings-modal').classList.add('hidden');
  const boundaries = await api('/api/boundaries');
  const b = boundaries.find((x) => x.id === id);
  if (b) {
    const layer = L.geoJSON(b.geojson);
    map.fitBounds(layer.getBounds(), { padding: [50, 50] });
  }
}

async function deleteBoundary(id) {
  if (!confirm('Delete this boundary?')) return;
  await api(`/api/boundaries/${id}`, { method: 'DELETE' });
  loadBoundaries();
  loadStudents();
}

document.getElementById('btn-draw-boundary').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');

  if (!drawingMode) {
    map.addControl(drawControl);
    drawingMode = true;
    document.getElementById('btn-draw-boundary').textContent = 'Cancel Drawing';
  } else {
    map.removeControl(drawControl);
    drawnItems.clearLayers();
    drawingMode = false;
    document.getElementById('btn-draw-boundary').textContent = 'Draw Boundary';
  }
});

map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.addLayer(e.layer);
  pendingGeojson = drawnItems.toGeoJSON();
  document.getElementById('boundary-modal').classList.remove('hidden');
});

document.getElementById('boundary-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name || !pendingGeojson) return;

  await api('/api/boundaries', {
    method: 'POST',
    body: JSON.stringify({ name, geojson: pendingGeojson }),
  });

  e.target.reset();
  document.getElementById('boundary-modal').classList.add('hidden');
  map.removeControl(drawControl);
  drawnItems.clearLayers();
  drawingMode = false;
  document.getElementById('btn-draw-boundary').textContent = 'Draw Boundary';
  pendingGeojson = null;

  loadBoundaries();
});

document.getElementById('btn-cancel-boundary').addEventListener('click', () => {
  document.getElementById('boundary-modal').classList.add('hidden');
  drawnItems.clearLayers();
  pendingGeojson = null;
});

document.getElementById('btn-upload-boundary').addEventListener('click', () => {
  document.getElementById('boundary-file-input').click();
});

document.getElementById('boundary-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const name = prompt('Name for this boundary:', file.name.replace(/\.[^.]+$/, ''));
  if (!name) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);

  const res = await fetch('/api/boundaries/upload', { method: 'POST', body: formData });
  const data = await res.json();

  if (data.error) {
    alert('Error: ' + data.error);
  } else {
    loadBoundaries();
  }

  e.target.value = '';
});

async function loadStudents() {
  const students = await api('/api/students');
  studentLayer.clearLayers();

  const outList = document.getElementById('out-list');
  const inList = document.getElementById('in-list');
  outList.innerHTML = '';
  inList.innerHTML = '';

  let inCount = 0, outCount = 0, unknownCount = 0, exceptionCount = 0, exceptionsIn = 0, exceptionsOut = 0;

  const coordCounts = {};

  students.sort((a, b) => {
    const aEx = a.exception === 1 ? 0 : 1;
    const bEx = b.exception === 1 ? 0 : 1;
    if (aEx !== bEx) return aEx - bEx;
    const nameA = `${a.last_name},${a.first_name}`.toLowerCase();
    const nameB = `${b.last_name},${b.first_name}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });

  students.forEach((s) => {
    const isException = s.exception === 1;

    if (s.latitude && s.longitude) {
      const coordKey = `${s.latitude},${s.longitude}`;
      coordCounts[coordKey] = (coordCounts[coordKey] || 0);
      const offsetIndex = coordCounts[coordKey]++;
      let offsetLat = s.latitude;
      let offsetLng = s.longitude;
      if (offsetIndex > 0) {
        const angle = offsetIndex * 2.4;
        const radius = 0.00006 * Math.sqrt(offsetIndex);
        offsetLat += radius * Math.cos(angle);
        offsetLng += radius * Math.sin(angle);
      }

      let color = s.in_district === 1 ? '#059669' : s.in_district === 0 ? '#dc2626' : '#6b7280';
      if (isException) color = '#f59e0b';

      const marker = L.circleMarker([offsetLat, offsetLng], {
        radius: isException ? 10 : 7,
        fillColor: color,
        color: isException ? '#000' : '#fff',
        weight: isException ? 2.5 : 1.5,
        fillOpacity: 0.9,
        pane: isException ? 'exceptionPane' : 'overlayPane',
      });
      studentLayer.addLayer(marker);

      const exceptionNote = isException
        ? `<br><strong style="color:#d97706">EXCEPTION: Entry code ${escapeHtml(s.entry_code)} ${s.in_district === 1 ? 'but lives IN district' : 'but lives OUT of district'}</strong>`
        : '';

      marker.bindPopup(`
        <strong>${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</strong><br>
        ${escapeHtml(s.address)}<br>
        Entry Code: ${escapeHtml(s.entry_code) || 'N/A'}<br>
        In District: ${s.in_district === 1 ? 'Yes' : s.in_district === 0 ? 'No' : 'Not checked'}
        ${exceptionNote}
      `);
    }

    if (isException) {
      exceptionCount++;
      if (s.in_district === 1) exceptionsIn++;
      else exceptionsOut++;
    }
    if (s.in_district === 1) inCount++;
    else if (s.in_district === 0) outCount++;
    else unknownCount++;

    const entryCodeBadge = s.entry_code
      ? ` <span class="status-badge badge-code">Code ${escapeHtml(s.entry_code)}</span>`
      : '';

    const exceptionDetail = isException
      ? `<div class="exception-detail">Entry code ${escapeHtml(s.entry_code)} but lives ${s.in_district === 1 ? 'IN' : 'OUT of'} district</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'item-card' + (isException ? ' item-exception' : '');
    card.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(s.last_name)}, ${escapeHtml(s.first_name)}${entryCodeBadge}</div>
        <div class="detail">${escapeHtml(s.address)}</div>
        ${exceptionDetail}
      </div>
    `;

    if (s.latitude && s.longitude) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        map.setView([s.latitude, s.longitude], 16);
      });

      const origRadius = isException ? 10 : 7;
      const origColor = isException ? '#000' : '#fff';
      const origWeight = isException ? 2.5 : 1.5;
      card.addEventListener('mouseenter', () => {
        marker.setStyle({ radius: origRadius + 5, color: '#1a56db', weight: 4 });
        marker.bringToFront();
      });
      card.addEventListener('mouseleave', () => {
        marker.setStyle({ radius: origRadius, color: origColor, weight: origWeight });
      });
    }

    if (s.in_district === 0) {
      outList.appendChild(card);
    } else if (s.in_district === 1) {
      inList.appendChild(card);
    } else {
      outList.appendChild(card);
    }
  });

  document.getElementById('out-section').classList.toggle('hidden', outList.children.length === 0);
  document.getElementById('in-section').classList.toggle('hidden', inList.children.length === 0);

  document.querySelector('.section-out').textContent = `Out of District (${outList.children.length})${exceptionsOut > 0 ? ` \u2014 ${exceptionsOut} exception${exceptionsOut > 1 ? 's' : ''}` : ''}`;
  document.querySelector('.section-in').textContent = `Eligible - In District (${inList.children.length})${exceptionsIn > 0 ? ` \u2014 ${exceptionsIn} exception${exceptionsIn > 1 ? 's' : ''}` : ''}`;

  document.getElementById('student-stats').innerHTML = `
    <div class="stat-item"><span class="stat-dot" style="background:#f59e0b"></span> Exceptions: ${exceptionCount}</div>
    <div class="stat-item"><span class="stat-dot" style="background:#dc2626"></span> Out: ${outCount}</div>
    <div class="stat-item"><span class="stat-dot" style="background:#059669"></span> In: ${inCount}</div>
    <div class="stat-item">Total: ${students.length}</div>
  `;
}


document.getElementById('btn-sync-sis').addEventListener('click', () => {
  if (!confirm('Sync students from Skyward SIS? This will update all student records.')) return;

  showProgress(0, 1, 'Connecting to Skyward SIS...');

  const eventSource = new EventSource('/api/sis/sync');

  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);

    if (data.error) {
      eventSource.close();
      hideProgress();
      alert('SIS sync error: ' + data.error);
      return;
    }

    if (data.done) {
      eventSource.close();
      showProgress(1, 1, `Imported ${data.imported} students. Starting geocoding...`);
      setTimeout(() => runProcessPipeline(), 500);
    } else if (data.step === 'connecting') {
      showProgress(0, 1, data.message);
    } else if (data.step === 'querying') {
      showProgress(0, 1, data.message);
    } else if (data.step === 'importing') {
      showProgress(0, 1, data.message);
    } else if (data.step === 'cleanup') {
      showProgress(1, 1, data.message);
    } else if (data.step === 'done_import') {
      showProgress(1, 1, `Imported ${data.imported} students (${data.skipped} skipped)`);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    hideProgress();
    alert('SIS sync connection failed. Check that the ODBC driver is installed and the SIS is reachable.');
    loadStudents();
  };
});


function runProcessPipeline() {
  showProgress(0, 1, 'Starting geocoding...');

  const eventSource = new EventSource('/api/students/process-all');

  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);

    if (data.done) {
      eventSource.close();
      hideProgress();
      loadStudents();
    } else if (data.step === 'info') {
      showProgress(0, 1, data.message);
    } else if (data.step === 'geocoding') {
      showProgress(data.current, data.total, `Geocoding batch ${data.batch || ''}`, data.geocoded, data.failed);
    } else if (data.step === 'checking') {
      showProgress(1, 1, data.message);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    hideProgress();
    loadStudents();
  };
}

async function geocodeStudent(id) {
  showLoading('Geocoding address...');
  const result = await api(`/api/students/${id}/geocode`, { method: 'POST' });
  hideLoading();

  if (result.error) {
    alert('Geocoding failed: ' + result.error);
  }
  loadStudents();
}

document.getElementById('btn-geocode-all').addEventListener('click', () => runProcessPipeline());

document.getElementById('btn-check-boundaries').addEventListener('click', async () => {
  showLoading('Checking boundaries...');
  const result = await api('/api/students/check-boundaries', { method: 'POST' });
  hideLoading();

  if (result.error) {
    alert('Error: ' + result.error);
  }
  loadStudents();
});

async function deleteStudent(id) {
  if (!confirm('Delete this student?')) return;
  await api(`/api/students/${id}`, { method: 'DELETE' });
  loadStudents();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showProgress(current, total, label, geocoded, failed) {
  let overlay = document.querySelector('.progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'progress-overlay';
    overlay.innerHTML = `
      <div class="progress-box">
        <div class="progress-label"></div>
        <div class="progress-bar-track"><div class="progress-bar-fill"></div></div>
        <div class="progress-count"></div>
        <div class="progress-stats"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.classList.remove('hidden');

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  overlay.querySelector('.progress-label').textContent = label || 'Processing...';
  overlay.querySelector('.progress-bar-fill').style.width = pct + '%';
  overlay.querySelector('.progress-count').textContent = `${current} of ${total} (${pct}%)`;
  overlay.querySelector('.progress-stats').textContent =
    geocoded !== undefined ? `Geocoded: ${geocoded} | Failed: ${failed}` : '';
}

function hideProgress() {
  const overlay = document.querySelector('.progress-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function showLoading(msg) {
  let overlay = document.querySelector('.loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    document.body.appendChild(overlay);
  }
  overlay.textContent = msg || 'Loading...';
  overlay.classList.remove('hidden');
}

function hideLoading() {
  const overlay = document.querySelector('.loading-overlay');
  if (overlay) overlay.classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', async () => {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');
  const status = await api('/api/settings/arcgis-status');
  document.getElementById('arcgis-status').textContent = status.hasApiKey
    ? 'An API key is currently saved. Enter a new one to replace it, or clear and save to remove.'
    : 'No API key set. Using free ArcGIS geocoding endpoint.';
  document.getElementById('arcgis-key-input').value = '';
});

document.getElementById('btn-cancel-settings').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById('arcgis-key-input').value.trim();
  await api('/api/settings/arcgis-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
  document.getElementById('settings-modal').classList.add('hidden');
  alert(apiKey ? 'API key saved. Geocoding will use the authenticated ArcGIS endpoint.' : 'API key removed. Geocoding will use the free ArcGIS endpoint.');
});

document.querySelectorAll('.section-filter').forEach((input) => {
  input.addEventListener('input', () => {
    const query = input.value.toLowerCase();
    const list = document.getElementById(input.dataset.list);
    for (const card of list.children) {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? '' : 'none';
    }
  });
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('cp-error');
  errorEl.classList.add('hidden');

  const currentPassword = document.getElementById('cp-current').value;
  const newPassword = document.getElementById('cp-new').value;
  const confirmPassword = document.getElementById('cp-confirm').value;

  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'New passwords do not match';
    errorEl.classList.remove('hidden');
    return;
  }

  const result = await api('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (result.error) {
    errorEl.textContent = result.error;
    errorEl.classList.remove('hidden');
  } else {
    alert('Password changed successfully');
    document.getElementById('change-password-form').reset();
    document.getElementById('settings-modal').classList.add('hidden');
  }
});

async function init() {
  const config = await fetch('/api/config').then(r => r.json());
  document.getElementById('site-name').textContent = config.siteName;
  document.getElementById('site-subtitle').textContent = 'District Boundary Checker';
  document.getElementById('page-title').textContent = config.siteName + ' - District Boundary Checker';

  await loadBoundaries();
  loadStudents();

  const bounds = boundaryLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}
init();
