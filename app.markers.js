(function () {
  window.activatePicker = function activatePicker(type) {
    if (S.picker === type) { clearPicker(); return; }
    clearPicker();
    S.picker = type;
    document.getElementById(`pb-${type}`).classList.add('on');
  };

  window.clearPicker = function clearPicker() {
    S.picker = null;
    document.querySelectorAll('.icon-btn[id^="pb-"]').forEach(b => b.classList.remove('on'));
  };

  window.placePoint = function placePoint(type, coords) {
    const el = document.createElement('div');
    el.className = type === 'origin' ? 'mrkr-origin' : 'mrkr-dest';
    const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(coords).addTo(map);
    m.on('dragend', () => {
      const lnglat = m.getLngLat();
      S[type] = { coords: [lnglat.lng, lnglat.lat], marker: m };
      showCoord(type, [lnglat.lng, lnglat.lat]);
      if (S.routes.length) calcRoutes();
    });
    if (type === 'origin') {
      if (window.originMarker) window.originMarker.remove();
      window.originMarker = m;
    } else {
      if (window.destMarker) window.destMarker.remove();
      window.destMarker = m;
    }
    S[type] = { coords, marker: m };
    showCoord(type, coords);
    map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 14), duration: 900 });
  };

  window.showCoord = function showCoord(type, c) {
    document.getElementById(`ct-${type}`).textContent = `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`;
  };

  window.toggleCorrect = function toggleCorrect() {
    S.correcting = !S.correcting;
    document.getElementById('btn-correct').classList.toggle('on', S.correcting);
    document.getElementById('wp-hint').classList.toggle('show', S.correcting);
    if (S.correcting && S.poiMode) togglePoiMode(false);
  };

  function ptSegDist(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  window.insertWaypoint = async function insertWaypoint(coords) {
    if (!S.routes[S.activeRoute]?.coords) return;
    const routeCoords = S.routes[S.activeRoute].coords;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const d = ptSegDist(coords, routeCoords[i], routeCoords[i + 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    const wrap = document.createElement('div');
    wrap.className = 'mrkr-wp-wrap';
    const dot = document.createElement('div');
    dot.className = 'mrkr-wp';
    wrap.appendChild(dot);
    const m = new maplibregl.Marker({ element: wrap, draggable: true, anchor: 'center' }).setLngLat(coords).addTo(map);
    const wpObj = { coords, marker: m, insertAfter: best };
    S.wps.push(wpObj);
    S.wps.sort((a, b) => a.insertAfter - b.insertAfter);
    wrap.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const i = S.wps.indexOf(wpObj);
      if (i !== -1) {
        S.wps.splice(i, 1);
        m.remove();
        calcRoutes();
        updateWpList();
      }
    });
    m.on('dragend', () => {
      wpObj.coords = [m.getLngLat().lng, m.getLngLat().lat];
      calcRoutes();
    });
    updateWpList();
    await calcRoutes();
  };

  window.updateWpList = function updateWpList() {
    const container = document.getElementById('wp-list');
    container.textContent = '';
    if (!S.wps.length) {
      const empty = document.createElement('div');
      empty.className = 'wp-item';
      empty.textContent = '— Sin puntos de paso —';
      container.appendChild(empty);
      return;
    }
    S.wps.forEach((wp, i) => {
      const row = document.createElement('div');
      row.className = 'wp-item';
      row.textContent = `📍 Punto ${i + 1}: ${wp.coords[1].toFixed(4)}, ${wp.coords[0].toFixed(4)}`;
      container.appendChild(row);
    });
  };

  window.undoWp = function undoWp() {
    if (S.wps.length) {
      S.wps.pop().marker.remove();
      updateWpList();
      if (S.routes.length) calcRoutes();
    }
  };

  window.clearWps = function clearWps() {
    S.wps.forEach(w => w.marker.remove());
    S.wps = [];
    updateWpList();
    if (S.routes.length) calcRoutes();
  };

  window.createPoiMarker = function createPoiMarker(poi) {
    const el = document.createElement('div');
    el.className = 'mrkr-poi';
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14 }).setText(poi.name);
    const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(poi.coords).setPopup(popup).addTo(map);
    el.addEventListener('contextmenu', ev => { ev.preventDefault(); removePoi(poi); });
    el.addEventListener('dblclick', ev => { ev.preventDefault(); renamePoi(poi); });
    m.on('dragend', () => {
      poi.coords = [m.getLngLat().lng, m.getLngLat().lat];
      updatePoiList();
    });
    poi.marker = m;
    if (S.poiLabels) poi.marker.togglePopup();
  };

  window.addPoi = function addPoi(coords) {
    const raw = prompt('Nombre del marcador', `Hito ${S.pois.length + 1}`);
    if (raw === null) return;
    const name = String(raw).trim() || `Hito ${S.pois.length + 1}`;
    const poi = { coords, name, marker: null };
    S.pois.push(poi);
    createPoiMarker(poi);
    if (!S.poiLabels) poi.marker.togglePopup();
    updatePoiList();
  };

  window.addPoiFromData = function addPoiFromData(coords, name) {
    const cleanName = String(name || '').trim() || `Hito ${S.pois.length + 1}`;
    const poi = { coords, name: cleanName, marker: null };
    S.pois.push(poi);
    createPoiMarker(poi);
  };

  function renamePoi(poi) {
    const raw = prompt('Renombrar marcador', poi.name);
    if (raw === null) return;
    const name = String(raw).trim();
    if (!name) return;
    poi.name = name;
    if (poi.marker?.getPopup) poi.marker.getPopup().setText(name);
    if (S.poiLabels && poi.marker?.getPopup && !poi.marker.getPopup().isOpen()) poi.marker.togglePopup();
    updatePoiList();
  }

  function removePoi(poi) {
    const i = S.pois.indexOf(poi);
    if (i !== -1) S.pois.splice(i, 1);
    if (poi.marker) poi.marker.remove();
    updatePoiList();
  }

  window.clearPois = function clearPois() {
    S.pois.forEach(p => { if (p.marker) p.marker.remove(); });
    S.pois = [];
    updatePoiList();
  };

  window.togglePoiMode = function togglePoiMode(force) {
    S.poiMode = (typeof force === 'boolean') ? force : !S.poiMode;
    document.getElementById('btn-poi').classList.toggle('on', S.poiMode);
    document.getElementById('poi-hint').classList.toggle('show', S.poiMode);
    if (S.poiMode && S.correcting) toggleCorrect();
    if (S.poiMode && S.picker) clearPicker();
  };

  window.togglePoiLabels = function togglePoiLabels(force) {
    S.poiLabels = (typeof force === 'boolean') ? force : !S.poiLabels;
    document.getElementById('btn-poi-labels').classList.toggle('on', S.poiLabels);
    S.pois.forEach(p => {
      const popup = p.marker?.getPopup ? p.marker.getPopup() : null;
      if (!popup) return;
      if (S.poiLabels && !popup.isOpen()) p.marker.togglePopup();
      if (!S.poiLabels && popup.isOpen()) p.marker.togglePopup();
    });
  };

  function setMarkerVisible(marker, visible) {
    try {
      const el = marker?.getElement?.();
      if (!el) return;
      el.style.display = visible ? '' : 'none';
    } catch {}
  }

  window.setWpsVisible = function setWpsVisible(visible) {
    (S.wps || []).forEach(w => setMarkerVisible(w.marker, visible));
  };

  window.setPoisVisible = function setPoisVisible(visible) {
    (S.pois || []).forEach(p => setMarkerVisible(p.marker, visible));
  };

  window.updatePoiList = function updatePoiList() {
    const container = document.getElementById('poi-list');
    if (!container) return;
    container.textContent = '';
    if (!S.pois.length) {
      const empty = document.createElement('div');
      empty.className = 'wp-item';
      empty.textContent = '— Sin marcadores —';
      container.appendChild(empty);
      return;
    }
    S.pois.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'wp-item';
      row.textContent = `📌 ${i + 1}: ${p.name} · ${p.coords[1].toFixed(4)}, ${p.coords[0].toFixed(4)}`;
      container.appendChild(row);
    });
  };

  window.setupMapEvents = function setupMapEvents() {
    map.on('click', e => {
      const ll = [e.lngLat.lng, e.lngLat.lat];
      if (S.picker === 'origin') { placePoint('origin', ll); clearPicker(); }
      else if (S.picker === 'dest') { placePoint('dest', ll); clearPicker(); }
      else if (S.poiMode) { addPoi(ll); }
      else if (S.correcting && S.routes[S.activeRoute]?.coords) { insertWaypoint(ll); }
    });
    map.on('mousemove', () => {
      map.getCanvas().style.cursor = (S.picker || S.correcting || S.poiMode) ? 'crosshair' : '';
    });
  };
})();
