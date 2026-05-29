(function () {
  const geocTimers = {};
  const GEOC_COUNTRY = 'cl';
  const GEOC_LANG = 'es';
  const GEOC_VIEWBOX = { minLon: -72.80, minLat: -38.90, maxLon: -72.40, maxLat: -38.60 };
  const GEOC_CENTER = { lon: -72.590, lat: -38.735 };

  const REV_CACHE_KEY = 'revCacheV1';
  const revCache = new Map();
  const searchCache = new Map();
  function searchCacheKey(params, useViewbox) {
    const qp = new URLSearchParams(params || {});
    qp.sort();
    return `${useViewbox ? 'vb1' : 'vb0'}:${qp.toString()}`;
  }
  function loadRevCache() {
    try {
      const raw = localStorage.getItem(REV_CACHE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      const entries = Array.isArray(obj?.entries) ? obj.entries : [];
      for (const [k, v] of entries) {
        if (typeof k === 'string' && typeof v === 'string') revCache.set(k, v);
      }
    } catch {}
  }
  function saveRevCache() {
    try {
      const maxEntries = 2500;
      const entries = Array.from(revCache.entries());
      const trimmed = entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
      localStorage.setItem(REV_CACHE_KEY, JSON.stringify({ v: 1, entries: trimmed }));
    } catch {}
  }
  function revKey(lat, lon) {
    return `${lat.toFixed(5)},${lon.toFixed(5)}`;
  }
  loadRevCache();
  let revBlockedUntil = 0;
  let revFailureCount = 0;
  let revInFlight = null;
  let revInFlightKey = null;

  function parseReverseLabel(j) {
    const a = j?.address || {};
    const road = a.road || a.pedestrian || a.residential || a.footway || a.neighbourhood || a.suburb || a.city_district || '';
    const hn = a.house_number || '';
    const city = a.city || a.town || a.village || '';
    return `${road}${hn ? ' ' + hn : ''}${city ? ' · ' + city : ''}`.trim() || '—';
  }

  function reverseJsonp(lat, lon) {
    const cb = `__revCb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { script.remove(); } catch {}
        try { clearTimeout(tid); } catch {}
      };
      window[cb] = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      const qp = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lon),
        zoom: '18',
        addressdetails: '1',
        'accept-language': GEOC_LANG,
        json_callback: cb
      });
      const script = document.createElement('script');
      script.src = `https://nominatim.openstreetmap.org/reverse?${qp.toString()}`;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('jsonp_error'));
      };
      const tid = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('jsonp_timeout'));
      }, 4500);
      document.head.appendChild(script);
    });
  }

  function buildNominatimUrl(params, useViewbox = true) {
    const qp = new URLSearchParams({
      format: 'jsonv2',
      limit: '7',
      addressdetails: '1',
      dedupe: '1',
      countrycodes: GEOC_COUNTRY,
      'accept-language': GEOC_LANG,
      ...params
    });
    if (useViewbox) qp.set('viewbox', `${GEOC_VIEWBOX.minLon},${GEOC_VIEWBOX.maxLat},${GEOC_VIEWBOX.maxLon},${GEOC_VIEWBOX.minLat}`);
    return `https://nominatim.openstreetmap.org/search?${qp.toString()}`;
  }

  function nominatimSearchJsonp(params, useViewbox = true) {
    const cb = `__geocCb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        try { delete window[cb]; } catch {}
        try { script.remove(); } catch {}
        try { clearTimeout(tid); } catch {}
      };
      window[cb] = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      const qp = new URLSearchParams({
        format: 'jsonv2',
        limit: '7',
        addressdetails: '1',
        dedupe: '1',
        countrycodes: GEOC_COUNTRY,
        'accept-language': GEOC_LANG,
        ...params,
        json_callback: cb
      });
      if (useViewbox) qp.set('viewbox', `${GEOC_VIEWBOX.minLon},${GEOC_VIEWBOX.maxLat},${GEOC_VIEWBOX.maxLon},${GEOC_VIEWBOX.minLat}`);
      const script = document.createElement('script');
      script.src = `https://nominatim.openstreetmap.org/search?${qp.toString()}`;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('jsonp_error'));
      };
      const tid = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('jsonp_timeout'));
      }, 4500);
      document.head.appendChild(script);
    });
  }

  async function fetchJson(url, timeoutMs = 6500) {
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function requestNominatim(params, useViewbox) {
    const key = searchCacheKey(params, useViewbox);
    if (searchCache.has(key)) return searchCache.get(key);

    let out = null;
    const canFetch = !(location && location.protocol === 'file:');
    if (canFetch) {
      try {
        out = await fetchJson(buildNominatimUrl(params, useViewbox), 6500);
      } catch {}
    }
    if (!out) {
      try {
        out = await nominatimSearchJsonp(params, useViewbox);
      } catch {}
    }
    if (!Array.isArray(out)) out = [];
    if (out.length) searchCache.set(key, out);
    return out;
  }

  function buildPhotonUrl(q) {
    const qp = new URLSearchParams({
      q,
      lang: GEOC_LANG,
      limit: '7',
      lon: String(GEOC_CENTER.lon),
      lat: String(GEOC_CENTER.lat),
      bbox: `${GEOC_VIEWBOX.minLon},${GEOC_VIEWBOX.minLat},${GEOC_VIEWBOX.maxLon},${GEOC_VIEWBOX.maxLat}`
    });
    return `https://photon.komoot.io/api/?${qp.toString()}`;
  }

  function normalizeQuery(q) {
    return q.replace(/[’´`]/g, "'").replace(/\s+/g, ' ').trim();
  }

  function parseStreetAndNumber(q) {
    const parts = q.split(',').map(s => s.trim()).filter(Boolean);
    const first = parts[0] || q;
    const m = first.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?)$/);
    if (!m) return null;
    const street = `${m[1].trim()} ${m[2]}`.trim();
    const city = parts[1] || 'Temuco';
    return { street, city };
  }

  function stripHouseNumber(q) {
    const parts = q.split(',').map(s => s.trim()).filter(Boolean);
    const first = parts[0] || q;
    const m = first.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?)$/);
    if (!m) return null;
    const streetOnly = m[1].trim();
    const rest = parts.slice(1).join(', ');
    return rest ? `${streetOnly}, ${rest}` : streetOnly;
  }

  function normName(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function extractHouseNumber(res) {
    const hnRaw = res?.address?.house_number ?? res?.properties?.housenumber;
    if (hnRaw != null) {
      const m = String(hnRaw).match(/\d+/);
      if (m) return parseInt(m[0], 10);
    }
    const dn = res?.display_name ? String(res.display_name) : '';
    const first = dn.split(',')[0] || '';
    const m2 = first.match(/(\d+)/);
    if (m2) return parseInt(m2[1], 10);
    return null;
  }

  function extractRoad(res) {
    const a = res?.address || {};
    return a.road || a.pedestrian || a.residential || a.footway || a.neighbourhood || a.suburb || '';
  }

  function makeSuggested(res, label) {
    return { lon: res.lon, lat: res.lat, display_name: label, address: res.address };
  }

  function photonDisplayName(p) {
    const parts = [];
    const hn = p.housenumber ? String(p.housenumber) : '';
    const st = p.street ? String(p.street) : (p.name ? String(p.name) : '');
    const line1 = `${st}${hn ? ' ' + hn : ''}`.trim();
    if (line1) parts.push(line1);
    if (p.city) parts.push(String(p.city));
    if (p.state) parts.push(String(p.state));
    if (p.country) parts.push(String(p.country));
    return parts.join(', ') || (p.name ? String(p.name) : '—');
  }

  function parseLngLatInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const patterns = [
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/,
    ];
    let a = null;
    let b = null;
    for (const re of patterns) {
      const m = s.match(re);
      if (m) { a = parseFloat(m[1]); b = parseFloat(m[2]); break; }
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    let lat = a;
    let lon = b;
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { lat = b; lon = a; }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lon, lat];
  }

  function showCoordSuggestion(drp, type, coords, rawLabel) {
    drp.textContent = '';
    const d = document.createElement('div');
    d.className = 's-drop-item';
    const label = rawLabel ? String(rawLabel).trim() : '';
    const text = label ? `📍 Usar coordenada: ${label}` : `📍 Usar coordenada: ${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;
    d.textContent = text;
    d.onclick = () => {
      placePoint(type, coords);
      const id = type === 'origin' ? 'si-origin' : 'si-dest';
      document.getElementById(id).value = `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;
      drp.style.display = 'none';
    };
    drp.appendChild(d);
    drp.style.display = 'block';
  }

  window.setupSearch = function setupSearch(inputId, dropId, type) {
    const inp = document.getElementById(inputId);
    const drp = document.getElementById(dropId);
    inp.addEventListener('input', () => {
      clearTimeout(geocTimers[type]);
      const q = inp.value.trim();
      const coords = parseLngLatInput(q);
      if (coords) { showCoordSuggestion(drp, type, coords, q); return; }
      if (q.length < 3) { drp.style.display = 'none'; return; }
      geocTimers[type] = setTimeout(() => doGeoc(q, drp, type), 400);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = inp.value.trim();
      const coords = parseLngLatInput(q);
      if (coords) {
        showCoordSuggestion(drp, type, coords, q);
        e.preventDefault();
        drp.querySelector('.s-drop-item')?.click();
      }
    });
    inp.addEventListener('blur', () => setTimeout(() => drp.style.display = 'none', 150));
  };

  async function doGeoc(q, drp, type) {
    const pastedCoords = parseLngLatInput(q);
    if (pastedCoords) { showCoordSuggestion(drp, type, pastedCoords, q); return; }
    const cleanQ = normalizeQuery(q);
    const hasNum = /\d/.test(cleanQ);
    const qNoNum = hasNum ? stripHouseNumber(cleanQ) : null;
    const parsedQ = hasNum ? parseStreetAndNumber(cleanQ) : null;
    const qFirst = cleanQ.split(',')[0] || cleanQ;
    const mReq = qFirst.match(/^(.*?)[\s,]+(\d+)[a-zA-Z]?$/);
    const reqStreetBase = mReq ? mReq[1].trim() : null;
    const reqNum = mReq ? parseInt(mReq[2], 10) : null;
    const reqStreetNorm = reqStreetBase ? normName(reqStreetBase) : null;
    let insertedSuggestion = false;
    let rs = await requestNominatim({ q: cleanQ }, true);

    if (!rs.length && parsedQ) {
      rs = await requestNominatim({ street: parsedQ.street, city: parsedQ.city, country: 'Chile' }, false);
    }

    if (!rs.length) {
      const ql = cleanQ.toLowerCase();
      let q2 = cleanQ;
      if (!ql.includes('temuco')) q2 = `${cleanQ}, Temuco`;
      if (!q2.toLowerCase().includes('chile')) q2 = `${q2}, Chile`;
      rs = await requestNominatim({ q: q2 }, false);
    }

    if (hasNum && qNoNum) {
      const mergeKey = (x) => {
        const lon = x?.lon ?? x?.longitude;
        const lat = x?.lat ?? x?.latitude;
        if (lon && lat) return `${String(lat)},${String(lon)}`;
        if (x?.place_id) return `pid:${x.place_id}`;
        return x?.display_name ? `dn:${x.display_name}` : '';
      };
      const seen = new Set(rs.map(mergeKey));
      const rs4 = await requestNominatim({ q: qNoNum, limit: '20', dedupe: '0' }, true);
      rs4.forEach(x => {
        const k = mergeKey(x);
        if (!k || seen.has(k)) return;
        seen.add(k);
        rs.push(x);
      });
    }

    if (!rs.length) {
      try {
        const rp = await fetch(buildPhotonUrl(cleanQ));
        const dp = await rp.json();
        const feats = Array.isArray(dp?.features) ? dp.features : [];
        rs = feats
          .map(f => {
            const coords = f?.geometry?.coordinates;
            const p = f?.properties || {};
            if (!Array.isArray(coords) || coords.length < 2) return null;
            const lon = Number(coords[0]);
            const lat = Number(coords[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            return { lon: String(lon), lat: String(lat), display_name: photonDisplayName(p), properties: p };
          })
          .filter(Boolean);
      } catch {}
    }

    if (hasNum && reqStreetBase && Number.isFinite(reqNum)) {
      const hasExactPre = rs.some(x => extractHouseNumber(x) === reqNum);
      if (!hasExactPre) {
        const city = parsedQ?.city || (cleanQ.split(',')[1] || '').trim() || 'Temuco';
        const candidates = [reqNum + 1, reqNum - 1, reqNum + 2, reqNum - 2, reqNum + 5, reqNum - 5, reqNum + 10, reqNum - 10]
          .filter(n => Number.isFinite(n) && n > 0);
        let bestHit = null;
        let bestHn = null;
        for (const cand of candidates) {
          try {
            const arr = await requestNominatim({ street: `${reqStreetBase} ${cand}`, city, country: 'Chile', limit: '3', dedupe: '0' }, false);
            if (!Array.isArray(arr) || !arr.length) continue;
            const matches = arr.filter(x => extractHouseNumber(x) === cand);
            const chosen = matches[0] || arr[0];
            bestHit = chosen;
            bestHn = extractHouseNumber(chosen) ?? cand;
            break;
          } catch {}
        }
        if (bestHit && Number.isFinite(bestHn)) {
          rs.unshift(makeSuggested(bestHit, `Sugerencia cercana: ${reqStreetBase} ${bestHn}, ${city}`));
          insertedSuggestion = true;
        }
      }
    }

    if (hasNum && reqStreetNorm && Number.isFinite(reqNum)) {
      const hasExact = rs.some(x => extractHouseNumber(x) === reqNum);
      if (!hasExact && !insertedSuggestion) {
        const withNums = rs
          .map(x => {
            const hn = extractHouseNumber(x);
            if (!Number.isFinite(hn)) return null;
            const road = extractRoad(x) || (x.display_name ? String(x.display_name).split(',')[0] : '');
            const roadNorm = normName(road);
            if (!roadNorm || !roadNorm.includes(reqStreetNorm)) return null;
            return { x, hn, diff: Math.abs(hn - reqNum) };
          })
          .filter(Boolean)
          .sort((a, b) => a.diff - b.diff);
        const best = withNums[0];
        if (best && best.diff <= 30) rs.unshift(makeSuggested(best.x, `Sugerencia cercana: ${reqStreetBase} ${best.hn}, Temuco`));
      }
    }

    drp.textContent = '';
    if (!rs.length) { drp.style.display = 'none'; return; }
    rs.forEach(res => {
      const d = document.createElement('div');
      d.className = 's-drop-item';
      d.textContent = res.display_name;
      d.onclick = () => {
        placePoint(type, [parseFloat(res.lon), parseFloat(res.lat)]);
        const id = type === 'origin' ? 'si-origin' : 'si-dest';
        const name = res.display_name.split(',').slice(0, 2).join(',');
        document.getElementById(id).value = (hasNum && !/\d/.test(name)) ? cleanQ : name;
        drp.style.display = 'none';
      };
      drp.appendChild(d);
    });
    drp.style.display = 'block';
  }

  window.reverseStreet = async function reverseStreet(lat, lon) {
    const key = revKey(lat, lon);
    if (revCache.has(key)) return revCache.get(key);
    const now = Date.now();
    if (now < revBlockedUntil) return '—';
    if (revFailureCount >= 2) return '—';

    if (revInFlight && revInFlightKey === key) {
      try { return await revInFlight; } catch { return '—'; }
    }

    revInFlightKey = key;
    revInFlight = (async () => {
      try {
        const j = await reverseJsonp(lat, lon);
        const out = parseReverseLabel(j);
        revCache.set(key, out);
        saveRevCache();
        revFailureCount = 0;
        return out;
      } catch {
        revFailureCount += 1;
        revBlockedUntil = Date.now() + (revFailureCount === 1 ? 30_000 : 120_000);
        return '—';
      } finally {
        revInFlight = null;
        revInFlightKey = null;
      }
    })();

    return await revInFlight;
  };

  window.updateStreetHudAt = async function updateStreetHudAt(pos, ts) {
    const hud = document.getElementById('hud-street');
    if (!hud || !hud.classList.contains('show')) return;
    if (!pos || pos.length < 2) return;
    if (!A.lastRevTs) A.lastRevTs = 0;
    if (!A.lastRevPos) A.lastRevPos = pos;
    const dt = ts - A.lastRevTs;
    const moved = metersBetween(A.lastRevPos, pos);
    if (dt < 2500 && moved < 120) return;
    A.lastRevTs = ts;
    A.lastRevPos = pos;
    const key = revKey(pos[1], pos[0]);
    if (A.lastRevKey === key) return;
    A.lastRevKey = key;
    const txt = await reverseStreet(pos[1], pos[0]);
    hud.textContent = txt;
  };
})();
