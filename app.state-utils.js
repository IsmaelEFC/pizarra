(function () {
  const MAX_MAP_ZOOM = 19;
  window.MAX_MAP_ZOOM = MAX_MAP_ZOOM;

  window.S = {
    origin: null,
    dest: null,
    wps: [],
    pois: [],
    routes: [],
    activeRoute: 0,
    picker: null,
    correcting: false,
    poiMode: false,
    poiLabels: false,
    turnActiveIdx: null,
    panelOpen: true,
    rightOpen: true,
    anim: { running: false, paused: false, idx: 0, s: 0, rafId: null, vMarker: null, bearing: 0, lastTs: null }
  };

  window.A = window.S.anim;

  window.elevChart = null;

  const ELEV_CACHE_KEY = 'elevCacheV1';
  const elevCache = new Map();
  window.elevCache = elevCache;
  window.ELEV_CACHE_KEY = ELEV_CACHE_KEY;

  function loadElevCache() {
    try {
      const raw = localStorage.getItem(ELEV_CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const entries = Array.isArray(obj?.entries) ? obj.entries : [];
      for (const [k, v] of entries) {
        if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) elevCache.set(k, v);
      }
    } catch {}
  }

  function saveElevCache() {
    try {
      const maxEntries = 2500;
      const entries = Array.from(elevCache.entries());
      const trimmed = entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
      localStorage.setItem(ELEV_CACHE_KEY, JSON.stringify({ v: 1, entries: trimmed }));
    } catch {}
  }

  function elevKey(lat, lon) {
    return `${lat.toFixed(5)},${lon.toFixed(5)}`;
  }

  window.loadElevCache = loadElevCache;
  window.saveElevCache = saveElevCache;
  window.elevKey = elevKey;
  loadElevCache();

  function metersBetween(a, b) {
    const toRad = (d) => d * Math.PI / 180;
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const dLat = lat2 - lat1;
    const dLon = toRad(b[0] - a[0]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function ensureRouteMetrics(route) {
    if (!route?.coords?.length) return;
    if (route.cumDist && route.cumDist.length === route.coords.length) return;
    const cum = new Array(route.coords.length);
    cum[0] = 0;
    for (let i = 1; i < route.coords.length; i++) {
      cum[i] = cum[i - 1] + metersBetween(route.coords[i - 1], route.coords[i]);
    }
    route.cumDist = cum;
    route.totalDistM = cum[cum.length - 1] || 0;
  }

  function posAtDistance(route, distM) {
    const coords = route.coords;
    const cum = route.cumDist;
    const total = route.totalDistM || 0;
    if (!coords?.length) return null;
    if (coords.length === 1 || total <= 0) return coords[0];
    const d = Math.max(0, Math.min(total, distM));
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i1 = lo;
    const i0 = Math.max(0, i1 - 1);
    const d0 = cum[i0];
    const d1 = cum[i1];
    const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    const p0 = coords[i0];
    const p1 = coords[i1];
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  }

  function fmtMeters(m) {
    const v = typeof m === 'number' && Number.isFinite(m) ? m : 0;
    if (v >= 1000) return `${(v / 1000).toFixed(1)} km`;
    return `${Math.round(v)} m`;
  }

  window.metersBetween = metersBetween;
  window.ensureRouteMetrics = ensureRouteMetrics;
  window.posAtDistance = posAtDistance;
  window.fmtMeters = fmtMeters;
})();
