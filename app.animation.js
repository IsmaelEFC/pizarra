(function () {
  function bearingBetween(a, b) {
    const toRad = (d) => d * Math.PI / 180;
    const toDeg = (r) => r * 180 / Math.PI;
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const dLon = toRad(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = (toDeg(Math.atan2(y, x)) + 360) % 360;
    return brng;
  }

  function lerpAngle(a, b, t) {
    const d = ((b - a + 540) % 360) - 180;
    return (a + d * t + 360) % 360;
  }

  function ensureVehicleMarker() {
    if (A.vMarker) return;
    const el = document.createElement('div');
    el.className = 'vmarker';
    A.vMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(S.routes[S.activeRoute].coords[0]).addTo(map);
  }

  function ensureTraceCache(route) {
    if (!route?.coords?.length) return null;
    if (!route.cumDist || route.cumDist.length !== route.coords.length) ensureRouteMetrics(route);
    const maxPts = 1500;
    const n = route.coords.length;
    const step = Math.max(1, Math.ceil(n / maxPts));
    if (route._traceCache && route._traceCache.step === step && Array.isArray(route._traceCache.coords) && route._traceCache.coords.length) {
      return route._traceCache;
    }
    const coords = [];
    const cum = [];
    for (let i = 0; i < n; i += step) {
      coords.push(route.coords[i]);
      cum.push(route.cumDist[i] || 0);
    }
    if (coords[coords.length - 1] !== route.coords[n - 1]) {
      coords.push(route.coords[n - 1]);
      cum.push(route.cumDist[n - 1] || 0);
    }
    route._traceCache = { step, coords, cum };
    return route._traceCache;
  }

  function updateTrace(route, distM, pos, force) {
    if (!map?.getSource) return;
    const src = map.getSource('route-trace');
    if (!src) return;
    const cache = ensureTraceCache(route);
    const cum = cache?.cum;
    const coordsBase = cache?.coords;
    if (!cum?.length || !coordsBase?.length) return;
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
    if (!force && A.lastTraceTs && (now - A.lastTraceTs) < 60) return;
    let idx = 0;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < distM) lo = mid + 1;
      else hi = mid;
    }
    idx = Math.max(0, lo);
    if (!force && A.lastTraceIdx === idx) return;
    A.lastTraceIdx = idx;
    A.lastTraceTs = now;
    const coords = coordsBase.slice(0, idx + 1);
    if (pos) coords.push(pos);
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
  }

  function updateProgress(route) {
    const pct = route.totalDistM > 0 ? (A.s / route.totalDistM) : 0;
    const clamped = Math.max(0, Math.min(1, pct));
    document.getElementById('prog-fill').style.width = `${(clamped * 100).toFixed(1)}%`;
    document.getElementById('pm-pct').textContent = `${Math.round(clamped * 100)}%`;
    document.getElementById('pm-dist').textContent = `${(A.s / 1000).toFixed(2)} km`;
  }

  function camShouldUpdate(ts) {
    if (!A.lastCamTs) { A.lastCamTs = ts; return true; }
    if (ts - A.lastCamTs >= 33) { A.lastCamTs = ts; return true; }
    return false;
  }

  function updateCamera(route, ts, pos) {
    if (!camShouldUpdate(ts)) return;
    const lookAheadM = Math.min(120, Math.max(35, (route.totalDistM || 0) / 600));
    const p2 = posAtDistance(route, Math.min(route.totalDistM, A.s + lookAheadM)) || pos;
    const targetBearing = bearingBetween(pos, p2);
    const alpha = Math.max(0.06, Math.min(0.22, (A.dt || 16) / 100));
    A.bearing = lerpAngle(A.bearing || targetBearing, targetBearing, alpha);
    map.jumpTo({ center: pos, bearing: A.bearing });
  }

  window.togglePlay = function togglePlay() {
    if (!S.routes.length) return;
    if (!A.running) beginAnim();
    else if (A.paused) resumeAnim();
    else pauseAnim();
  };

  function beginAnim() {
    const route = S.routes[S.activeRoute];
    ensureRouteMetrics(route);
    ensureVehicleMarker();
    A.running = true;
    A.paused = false;
    A.lastTs = null;
    document.getElementById('btn-play').textContent = '⏸';
    A.rafId = requestAnimationFrame(animFrame);
  }

  function pauseAnim() {
    A.paused = true;
    document.getElementById('btn-play').textContent = '▶';
  }

  function resumeAnim() {
    A.paused = false;
    A.lastTs = null;
    document.getElementById('btn-play').textContent = '⏸';
    A.rafId = requestAnimationFrame(animFrame);
  }

  function finishAnim() {
    A.running = false;
    A.paused = false;
    document.getElementById('btn-play').textContent = '▶';
  }

  window.seekReset = function seekReset() {
    if (!S.routes.length) return;
    if (A.rafId) cancelAnimationFrame(A.rafId);
    A.rafId = null;
    A.running = false;
    A.paused = false;
    A.s = 0;
    A.lastTs = null;
    A.lastTraceIdx = null;
    A.lastTraceTs = null;
    document.getElementById('btn-play').textContent = '▶';
    const route = S.routes[S.activeRoute];
    ensureRouteMetrics(route);
    const p = posAtDistance(route, 0);
    if (A.vMarker) A.vMarker.setLngLat(p);
    updateTrace(route, 0, p, true);
    updateProgress(route);
    setActiveTurnByDistance(0);
  };

  window.seekClick = function seekClick(ev) {
    if (!S.routes.length) return;
    const bar = ev.currentTarget;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    seekToPct(pct);
  };

  window.seekToPct = function seekToPct(pct) {
    if (!S.routes.length) return;
    const route = S.routes[S.activeRoute];
    ensureRouteMetrics(route);
    const p = Math.max(0, Math.min(1, pct));
    A.s = p * route.totalDistM;
    const pos = posAtDistance(route, A.s);
    ensureVehicleMarker();
    A.vMarker.setLngLat(pos);
    updateProgress(route);
    setActiveTurnByDistance(A.s);
  };

  function animFrame(ts) {
    if (!A.running) return;
    if (A.paused) { A.rafId = requestAnimationFrame(animFrame); return; }
    const route = S.routes[S.activeRoute];
    ensureRouteMetrics(route);
    const speedMult = parseFloat(document.getElementById('spd-slider').value) || 1;
    const baseMps = 18;
    if (A.lastTs == null) A.lastTs = ts;
    const dt = Math.min(80, ts - A.lastTs);
    A.dt = dt;
    A.lastTs = ts;
    A.s += baseMps * speedMult * (dt / 1000);
    if (A.s >= route.totalDistM) { A.s = route.totalDistM; }
    const pos = posAtDistance(route, A.s);
    ensureVehicleMarker();
    A.vMarker.setLngLat(pos);
    updateTrace(route, A.s, pos, false);
    updateProgress(route);
    setActiveTurnByDistance(A.s);
    updateStreetHudAt(pos, ts);
    updateCamera(route, ts, pos);
    if (A.s >= route.totalDistM) { finishAnim(); return; }
    A.rafId = requestAnimationFrame(animFrame);
  }

  window.resetView = function resetView() {
    if (!S.routes.length) {
      map.flyTo({ center: [-72.590, -38.735], zoom: 13, pitch: 52, bearing: -10, duration: 900 });
      return;
    }
    const route = S.routes[S.activeRoute];
    const bounds = new maplibregl.LngLatBounds();
    route.coords.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: { top: 80, bottom: 100, left: 310, right: 360 }, pitch: 48, duration: 900, maxZoom: MAX_MAP_ZOOM });
  };
})();
