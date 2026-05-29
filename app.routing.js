(function () {
  function fmtDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  function updateRouteSelector() {
    const el = document.getElementById('route-selector');
    el.textContent = '';
    if (!S.routes.length) return;
    S.routes.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'route-btn' + (i === S.activeRoute ? ' active' : '');
      const km = typeof r?.distance === 'number' && Number.isFinite(r.distance) ? (r.distance / 1000) : null;
      const eta = typeof r?.duration === 'number' && Number.isFinite(r.duration) ? fmtDuration(r.duration) : null;
      const base = i === 0 ? 'Ruta principal' : `Alternativa ${i}`;
      b.textContent = `${base}${km != null ? ` · ${km.toFixed(1)} km` : ''}${eta ? ` · ${eta}` : ''}`;
      b.onclick = () => setActiveRoute(i);
      el.appendChild(b);
    });
  }

  function updateRouteStats(route) {
    document.getElementById('stat-dist').textContent = fmtMeters(route.distance);
    document.getElementById('stat-dur').textContent = fmtDuration(route.duration);
    document.getElementById('pm-total').textContent = `${(route.distance / 1000).toFixed(2)} km total`;
    document.getElementById('pm-dist').textContent = '0.00 km';
    document.getElementById('pm-pct').textContent = '0%';
    document.getElementById('prog-fill').style.width = '0%';
  }

  function stepIcon(step) {
    const m = step?.maneuver || {};
    const t = m.type || '';
    const mod = m.modifier || '';
    if (t === 'roundabout') return '⟳';
    if (t === 'arrive') return '🏁';
    if (t === 'depart') return '🚦';
    if (mod.includes('left')) return '⬅';
    if (mod.includes('right')) return '➡';
    if (mod.includes('uturn')) return '⤵';
    if (mod.includes('straight')) return '⬆';
    return '•';
  }

  function stepText(step) {
    const name = step?.name ? String(step.name) : '';
    const m = step?.maneuver || {};
    const type = m.type || '';
    if (type === 'arrive') return 'Llegada';
    if (type === 'depart') return 'Salida';
    if (!name) return type ? type : '—';
    return name;
  }

  window.buildTurnsForRoute = function buildTurnsForRoute(route) {
    const turns = [];
    let acc = 0;
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    for (const leg of legs) {
      const steps = Array.isArray(leg?.steps) ? leg.steps : [];
      for (const st of steps) {
        const dist = Number(st?.distance) || 0;
        turns.push({ sStart: acc, sEnd: acc + dist, icon: stepIcon(st), text: stepText(st), distM: dist });
        acc += dist;
      }
    }
    route.turns = turns;
  };

  window.renderTurns = function renderTurns() {
    const container = document.getElementById('turn-list');
    container.textContent = '';
    const route = S.routes[S.activeRoute];
    if (!route?.turns?.length) return;
    route.turns.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'turn-item' + (idx === S.turnActiveIdx ? ' on' : '');
      row.textContent = `${t.icon} ${t.text} · ${fmtMeters(t.distM)}`;
      row.onclick = () => {
        S.turnActiveIdx = idx;
        renderTurns();
        if (route.totalDistM > 0) {
          const pct = t.sStart / route.totalDistM;
          seekToPct(pct);
        }
      };
      container.appendChild(row);
    });
  };

  window.setActiveTurnByDistance = function setActiveTurnByDistance(sM) {
    const route = S.routes[S.activeRoute];
    if (!route?.turns?.length) return;
    let idx = null;
    for (let i = 0; i < route.turns.length; i++) {
      const t = route.turns[i];
      if (sM >= t.sStart && sM <= t.sEnd) { idx = i; break; }
    }
    if (idx !== S.turnActiveIdx) {
      S.turnActiveIdx = idx;
      renderTurns();
    }
  };

  window.setActiveRoute = function setActiveRoute(i) {
    if (i < 0 || i >= S.routes.length) return;
    S.activeRoute = i;
    updateRouteSelector();
    const route = S.routes[i];
    ensureRouteMetrics(route);
    updateRouteStats(route);
    buildTurnsForRoute(route);
    renderTurns();
    drawAllRoutes();
    scheduleFetchElevationProfile(route);
    resetView();
  };

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function fetchJsonWithTimeout(url, ms) {
    const timeoutMs = (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) ? ms : 8000;
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchElevChunkOpenElevation(coords) {
    const locs = coords.map(c => `${c[1]},${c[0]}`).join('|');
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(locs)}`;
    const j = await fetchJsonWithTimeout(url, 9000);
    const results = Array.isArray(j?.results) ? j.results : [];
    return results.map(x => Number(x?.elevation));
  }

  async function fetchElevChunkOpenTopoData(coords) {
    const locs = coords.map(c => `${c[1]},${c[0]}`).join('|');
    const url = `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(locs)}`;
    const j = await fetchJsonWithTimeout(url, 9000);
    const results = Array.isArray(j?.results) ? j.results : [];
    return results.map(x => Number(x?.elevation));
  }

  async function fetchElevChunkOpenMeteo(coords) {
    const lats = coords.map(c => c[1]).join(',');
    const lons = coords.map(c => c[0]).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lons)}`;
    const j = await fetchJsonWithTimeout(url, 9000);
    const elev = Array.isArray(j?.elevation) ? j.elevation : [];
    return elev.map(x => Number(x));
  }

  async function fetchElevChunk(coords) {
    const providers = [fetchElevChunkOpenElevation, fetchElevChunkOpenTopoData, fetchElevChunkOpenMeteo];
    for (let i = 0; i < providers.length; i++) {
      try {
        const out = await providers[i](coords);
        if (Array.isArray(out) && out.length === coords.length) return out;
      } catch {}
      if (i < providers.length - 1) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    return coords.map(() => NaN);
  }

  async function fetchElevations(coords) {
    const out = new Array(coords.length);
    const uncached = [];
    const uncachedIdx = [];
    for (let i = 0; i < coords.length; i++) {
      const k = elevKey(coords[i][1], coords[i][0]);
      if (elevCache.has(k)) out[i] = elevCache.get(k);
      else { uncached.push(coords[i]); uncachedIdx.push(i); }
    }
    const parts = chunk(uncached, 90);
    let pOffset = 0;
    for (const part of parts) {
      const elevs = await fetchElevChunk(part);
      for (let j = 0; j < part.length; j++) {
        const i = uncachedIdx[pOffset + j];
        const v = elevs[j];
        out[i] = v;
        if (Number.isFinite(v)) elevCache.set(elevKey(part[j][1], part[j][0]), v);
      }
      pOffset += part.length;
      saveElevCache();
      await new Promise(r => setTimeout(r, 120));
    }
    return out;
  }

  window.fetchElevationProfile = async function fetchElevationProfile(route) {
    const coords = route?.coords;
    if (!coords?.length) return;
    const minPts = 40;
    const maxPts = 140;
    const sample = Math.min(maxPts, Math.max(minPts, Math.round(coords.length / 12)));
    const idxs = new Set();
    for (let i = 0; i < sample; i++) idxs.add(Math.round(i * (coords.length - 1) / (sample - 1)));
    const picks = Array.from(idxs).sort((a, b) => a - b).map(i => coords[i]);
    let elev = [];
    try {
      elev = await fetchElevations(picks);
    } catch {
      elev = picks.map(() => NaN);
    }
    const vals = elev.filter(v => Number.isFinite(v));
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    document.getElementById('stat-elev').textContent = vals.length ? `${Math.round(min)}–${Math.round(max)} m` : '—';
    if (!vals.length && typeof showToast === 'function') showToast('Elevación no disponible (servicios saturados).', 'warn');
    let ascent = 0;
    let descent = 0;
    for (let i = 1; i < elev.length; i++) {
      const a = elev[i - 1];
      const b = elev[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const d = b - a;
      if (d > 0) ascent += d;
      else descent += -d;
    }
    document.getElementById('stat-ascent').textContent = ascent ? `${Math.round(ascent)} m` : '—';
    document.getElementById('stat-descent').textContent = descent ? `${Math.round(descent)} m` : '—';
    const canvas = document.getElementById('elev-canvas');
    const parentW = canvas?.parentElement?.clientWidth || 0;
    if (canvas) {
      canvas.width = Math.max(240, parentW ? parentW : 320);
      canvas.height = 110;
    }
    const ctx = canvas.getContext('2d');
    const labels = picks.map((_, i) => i);
    const data = elev.map(v => Number.isFinite(v) ? v : null);
    if (elevChart) { elevChart.destroy(); elevChart = null; }
    elevChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: '#00d2ff', backgroundColor: 'rgba(0,210,255,.12)', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  };

  window.calcRoutes = async function calcRoutes() {
    if (!S.origin?.coords || !S.dest?.coords) return;
    if (!mapInitialized) return;
    if (A.running) seekReset();
    const coords = [S.origin.coords].concat(S.wps.map(w => w.coords)).concat([S.dest.coords]);
    const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?alternatives=true&steps=true&overview=full&geometries=geojson`;
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j.code !== 'Ok' || !Array.isArray(j.routes) || !j.routes.length) return;
      S.routes = j.routes.map(rt => ({
        coords: rt.geometry.coordinates,
        geometry: rt.geometry,
        distance: rt.distance,
        duration: rt.duration,
        legs: rt.legs || []
      }));
      S.activeRoute = 0;
      ensureRouteMetrics(S.routes[0]);
      updateRouteSelector();
      updateRouteStats(S.routes[0]);
      buildTurnsForRoute(S.routes[0]);
      renderTurns();
      document.getElementById('panel-player').classList.add('show');
      document.getElementById('hud-street').classList.add('show');
      drawAllRoutes();
      scheduleFetchElevationProfile(S.routes[0]);
      resetView();
    } catch {}
  };
})();

(function () {
  let elevTimer = null;
  let lastSig = '';
  window.scheduleFetchElevationProfile = function scheduleFetchElevationProfile(route) {
    if (!route?.coords?.length) return;
    const c = route.coords;
    const mid = c[Math.floor(c.length / 2)] || c[0];
    const sig = `${c.length}|${c[0]?.[0]?.toFixed?.(5)},${c[0]?.[1]?.toFixed?.(5)}|${mid?.[0]?.toFixed?.(5)},${mid?.[1]?.toFixed?.(5)}|${c[c.length - 1]?.[0]?.toFixed?.(5)},${c[c.length - 1]?.[1]?.toFixed?.(5)}`;
    if (sig === lastSig) return;
    lastSig = sig;
    if (elevTimer) clearTimeout(elevTimer);
    elevTimer = setTimeout(() => {
      elevTimer = null;
      if (typeof fetchElevationProfile === 'function') fetchElevationProfile(route);
    }, 450);
  };
})();
