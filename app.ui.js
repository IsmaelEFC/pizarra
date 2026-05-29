(function () {
  const SAVE_KEY = 'rutaSaveV4';

  function setDisp(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? '' : 'none';
  }

  window.showToast = function showToast(msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    const text = String(msg || '').trim();
    if (!text) return;
    el.textContent = text;
    el.classList.remove('warn', 'err');
    if (kind === 'warn') el.classList.add('warn');
    if (kind === 'err') el.classList.add('err');
    el.classList.add('show');
    if (!window.__toastState) window.__toastState = { t: null };
    if (window.__toastState.t) clearTimeout(window.__toastState.t);
    window.__toastState.t = setTimeout(() => {
      try { el.classList.remove('show', 'warn', 'err'); } catch {}
    }, 2800);
  };

  window.togglePanel = function togglePanel() {
    S.panelOpen = !S.panelOpen;
    document.getElementById('panel-left').classList.toggle('hidden', !S.panelOpen);
  };

  window.toggleRightPanel = function toggleRightPanel() {
    S.rightOpen = !S.rightOpen;
    document.getElementById('panel-right').classList.toggle('hidden', !S.rightOpen);
  };

  window.saveRouteToLocal = function saveRouteToLocal() {
    try {
      const data = {
        v: 5,
        origin: S.origin?.coords || null,
        dest: S.dest?.coords || null,
        wps: S.wps.map(w => w.coords),
        pois: S.pois.map(p => ({ coords: p.coords, name: p.name })),
        poiLabels: !!S.poiLabels,
        activeRoute: S.activeRoute,
        style: currentStyle
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      alert('Guardado');
    } catch {
      alert('No se pudo guardar');
    }
  };

  window.loadRouteFromLocal = function loadRouteFromLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { alert('No hay guardado'); return; }
      const data = JSON.parse(raw);
      resetAll();
      if (data.style) setMapStyle(data.style);
      if (Array.isArray(data.origin) && data.origin.length === 2) placePoint('origin', data.origin);
      if (Array.isArray(data.dest) && data.dest.length === 2) placePoint('dest', data.dest);
      if (Array.isArray(data.wps)) {
        data.wps.forEach(c => {
          if (!Array.isArray(c) || c.length !== 2) return;
          const wrap = document.createElement('div');
          wrap.className = 'mrkr-wp-wrap';
          const dot = document.createElement('div');
          dot.className = 'mrkr-wp';
          wrap.appendChild(dot);
          const m = new maplibregl.Marker({ element: wrap, draggable: true, anchor: 'center' }).setLngLat(c).addTo(map);
          const wpObj = { coords: c, marker: m, insertAfter: 0 };
          S.wps.push(wpObj);
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
        });
      }
      if (Array.isArray(data.pois)) {
        data.pois.forEach(p => {
          if (!Array.isArray(p?.coords) || p.coords.length !== 2) return;
          addPoiFromData(p.coords, p.name);
        });
      }
      S.poiLabels = !!data.poiLabels;
      document.getElementById('btn-poi-labels').classList.toggle('on', S.poiLabels);
      if (S.poiLabels) togglePoiLabels(true);
      updateWpList();
      updatePoiList();
      if (S.origin && S.dest) calcRoutes();
      alert('Cargado');
    } catch {
      alert('No se pudo cargar');
    }
  };

  window.exportRouteJSON = function exportRouteJSON() {
    try {
      const data = {
        v: 5,
        origin: S.origin?.coords || null,
        dest: S.dest?.coords || null,
        wps: S.wps.map(w => w.coords),
        pois: S.pois.map(p => ({ coords: p.coords, name: p.name })),
        poiLabels: !!S.poiLabels,
        activeRoute: S.activeRoute,
        style: currentStyle
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ruta.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('No se pudo exportar');
    }
  };

  window.importRouteJSON = function importRouteJSON(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { alert('Archivo muy grande'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ''));
        resetAll();
        if (data.style) setMapStyle(data.style);
        if (Array.isArray(data.origin) && data.origin.length === 2) placePoint('origin', data.origin);
        if (Array.isArray(data.dest) && data.dest.length === 2) placePoint('dest', data.dest);
        if (Array.isArray(data.wps)) {
          data.wps.forEach(c => {
            if (!Array.isArray(c) || c.length !== 2) return;
            const wrap = document.createElement('div');
            wrap.className = 'mrkr-wp-wrap';
            const dot = document.createElement('div');
            dot.className = 'mrkr-wp';
            wrap.appendChild(dot);
            const m = new maplibregl.Marker({ element: wrap, draggable: true, anchor: 'center' }).setLngLat(c).addTo(map);
            const wpObj = { coords: c, marker: m, insertAfter: 0 };
            S.wps.push(wpObj);
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
          });
        }
        if (Array.isArray(data.pois)) {
          data.pois.forEach(p => {
            if (!Array.isArray(p?.coords) || p.coords.length !== 2) return;
            addPoiFromData(p.coords, p.name);
          });
        }
        S.poiLabels = !!data.poiLabels;
        if (S.poiLabels) togglePoiLabels(true);
        updateWpList();
        updatePoiList();
        if (S.origin && S.dest) calcRoutes();
        alert('Ruta importada');
      } catch {
        alert('JSON inválido');
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  };

  window.recState = { running: false, recorder: null, chunks: [], stream: null };

  function setRecUi(running) {
    const badge = document.getElementById('rec-badge');
    const btn = document.getElementById('btn-rec');
    badge.style.display = running ? 'inline-block' : 'none';
    btn.textContent = running ? '⏹ Detener' : '⏺ Grabar';
  }

  window.toggleRecording = function toggleRecording() {
    if (recState.running) stopRecording();
    else startRecording();
  };

  function startRecording() {
    try {
      const canvas = map.getCanvas();
      const stream = canvas.captureStream(60);
      const preferredTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      const mimeType = preferredTypes.find(t => (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) || '';
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000
      });
      recState.running = true;
      recState.stream = stream;
      recState.recorder = recorder;
      recState.chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) recState.chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recState.chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruta_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };
      recorder.start(1000);
      setRecUi(true);
    } catch {
      alert('No se pudo iniciar grabación');
      recState.running = false;
      setRecUi(false);
    }
  }

  window.stopRecording = function stopRecording() {
    try {
      recState.running = false;
      setRecUi(false);
      if (recState.recorder && recState.recorder.state !== 'inactive') recState.recorder.stop();
      recState.stream?.getTracks?.().forEach(t => t.stop());
    } catch {}
  };

  window.resetAll = function resetAll() {
    if (recState.running) stopRecording();
    if (A.rafId) cancelAnimationFrame(A.rafId);
    Object.assign(A, { running: false, paused: false, idx: 0, s: 0, rafId: null, lastTs: null });
    A.lastTraceIdx = null;
    if (A.vMarker) { A.vMarker.remove(); A.vMarker = null; }
    if (window.originMarker) { window.originMarker.remove(); window.originMarker = null; }
    if (window.destMarker) { window.destMarker.remove(); window.destMarker = null; }
    S.wps.forEach(w => { if (w.marker) w.marker.remove(); });
    S.pois.forEach(p => { if (p.marker) p.marker.remove(); });
    S.wps = [];
    S.pois = [];
    S.routes = [];
    S.origin = null;
    S.dest = null;
    S.activeRoute = 0;
    clearPicker();
    S.correcting = false;
    S.poiMode = false;
    S.poiLabels = false;
    document.getElementById('btn-poi-labels').classList.remove('on');
    document.getElementById('btn-poi').classList.remove('on');
    document.getElementById('poi-hint').classList.remove('show');
    ['r-glow', 'r-main', 'r-trace', 'r-alt-glow', 'r-alt-main'].forEach(id => {
      if (map.getLayer && map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource && map.getSource('route-full')) map.removeSource('route-full');
    if (map.getSource && map.getSource('route-trace')) map.removeSource('route-trace');
    if (map.getSource && map.getSource('route-alt')) map.removeSource('route-alt');
    document.getElementById('hud-street').classList.remove('show');
    document.getElementById('turn-list').textContent = '';
    S.turnActiveIdx = null;
    document.getElementById('panel-player').classList.remove('show');
    document.getElementById('ct-origin').textContent = '—';
    document.getElementById('ct-dest').textContent = '—';
    document.getElementById('si-origin').value = '';
    document.getElementById('si-dest').value = '';
    document.getElementById('btn-correct').classList.remove('on');
    document.getElementById('wp-hint').classList.remove('show');
    document.getElementById('prog-fill').style.width = '0%';
    document.getElementById('pm-pct').textContent = '0%';
    document.getElementById('pm-dist').textContent = '0.00 km';
    document.getElementById('pm-total').textContent = '— km total';
    document.getElementById('stat-dist').textContent = '—';
    document.getElementById('stat-dur').textContent = '—';
    document.getElementById('stat-ascent').textContent = '—';
    document.getElementById('stat-descent').textContent = '—';
    document.getElementById('stat-elev').textContent = '—';
    updateWpList();
    updatePoiList();
    if (elevChart) { elevChart.destroy(); elevChart = null; }
    map.flyTo({ center: [-72.590, -38.735], zoom: 13, pitch: 52, bearing: -10, duration: 900 });
  };

  function seekDelta(dir) {
    if (!S.routes.length) return;
    const route = S.routes[S.activeRoute];
    ensureRouteMetrics(route);
    const pct = route.totalDistM > 0 ? A.s / route.totalDistM : 0;
    const next = Math.max(0, Math.min(1, pct + dir * 0.02));
    seekToPct(next);
  }

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea';
    if (typing) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekDelta(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekDelta(1); }
    else if (e.key === 'Escape') { e.preventDefault(); resetView(); }
  });
})();
