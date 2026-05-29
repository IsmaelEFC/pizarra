(function () {
  if (typeof maplibregl !== 'undefined') {
    if (typeof maplibregl.maxParallelImageRequests === 'number') maplibregl.maxParallelImageRequests = Math.max(maplibregl.maxParallelImageRequests, 32);
    if (typeof maplibregl.workerCount === 'number') maplibregl.workerCount = Math.max(maplibregl.workerCount, 2);
  }

  window.STREET_STYLE = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#060a12' } },
      { id: 'street', type: 'raster', source: 'osm', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 250 } }
    ]
  };

  window.SATELLITE_STYLE = {
    version: 8,
    sources: {
      satellite_lo: {
        type: 'raster',
        tiles: [
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief/default/2013-12-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
        ],
        tileSize: 256,
        maxzoom: 8,
        attribution: 'NASA GIBS'
      },
      satellite_hi: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        minzoom: 8,
        maxzoom: 19,
        attribution: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      },
      sat_labels: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© OpenStreetMap contributors © CARTO'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#060a12' } },
      {
        id: 'satellite-lo',
        type: 'raster',
        source: 'satellite_lo',
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 7.6, 1, 8, 0],
          'raster-resampling': 'linear',
          'raster-fade-duration': 250
        }
      },
      {
        id: 'satellite-hi',
        type: 'raster',
        source: 'satellite_hi',
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 7.6, 0, 8, 1],
          'raster-resampling': 'linear',
          'raster-fade-duration': 250
        }
      },
      {
        id: 'satellite-labels',
        type: 'raster',
        source: 'sat_labels',
        paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }
      }
    ]
  };

  window.currentStyle = 'satellite';
  window.mapInitialized = false;
  window.map = null;
  window.miniMap = null;
  window.miniMarker = null;
  window.miniInitialized = false;
  let webglRecovering = false;
  let webglFailureCount = 0;
  window.terrainEnabled = (() => {
    try {
      const v = localStorage.getItem('terrainEnabledV1');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {}
    return false;
  })();
  const TERRAIN_EXAGGERATION = 1.65;

  function showWebglFail(msg) {
    try { window.closeOpEditor?.(); } catch {}
    try { window.closeLayers?.(); } catch {}
    try {
      document.getElementById('opedit-backdrop')?.classList.remove('show');
      document.getElementById('opedit-modal')?.classList.remove('show');
      document.getElementById('layers-backdrop')?.classList.remove('show');
      document.getElementById('layers-modal')?.classList.remove('show');
      document.body?.classList.remove('modal-open');
    } catch {}
    const box = document.getElementById('webgl-fail');
    const m = document.getElementById('webgl-fail-msg');
    if (m) m.textContent = msg || 'No se pudo inicializar el motor gráfico del mapa.';
    if (box) box.classList.add('show');
  }

  function hideWebglFail() {
    const box = document.getElementById('webgl-fail');
    if (box) box.classList.remove('show');
  }

  function hasWebglSupport() {
    try {
      const c = document.createElement('canvas');
      const gl2 = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
      if (gl2) return true;
      const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) || c.getContext('experimental-webgl');
      return !!gl;
    } catch {
      return false;
    }
  }

  function showMaplibreLoadFail() {
    showWebglFail('No se pudo cargar el motor del mapa (MapLibre). Revisa conexión a internet o bloqueos (firewall/proxy). Si abriste el HTML como archivo, prueba abrirlo desde un servidor local.');
  }

  function updateTerrainButton() {
    const btn = document.getElementById('btn-terrain');
    if (!btn) return;
    btn.classList.toggle('active', !!window.terrainEnabled);
  }

  function ensureTerrainSourcesAndLayers() {
    if (!map || !map.addSource) return;
    const demTiles = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: demTiles,
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium'
      });
    }
    if (!map.getSource('hillshade-dem')) {
      map.addSource('hillshade-dem', {
        type: 'raster-dem',
        tiles: demTiles,
        tileSize: 256,
        maxzoom: 15,
        encoding: 'terrarium'
      });
    }
    if (!map.getLayer('hillshade')) {
      const beforeId = map.getLayer('satellite-labels')
        ? 'satellite-labels'
        : (map.getLayer('satellite') ? 'satellite' : (map.getLayer('street') ? 'street' : undefined));
      map.addLayer({
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshade-dem',
        paint: {
          'hillshade-exaggeration': 0.8,
          'hillshade-shadow-color': '#1a2a3a',
          'hillshade-illumination-direction': 315,
          'hillshade-illumination-anchor': 'map'
        },
        layout: { visibility: 'visible' }
      }, beforeId);
    }
    if (!map.getLayer('sky')) {
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 85.0],
          'sky-atmosphere-sun-intensity': 15,
          'sky-atmosphere-halo-color': 'rgba(200, 220, 255, 0.8)',
          'sky-atmosphere-color': 'rgba(120, 180, 255, 0.6)'
        }
      });
    }
  }

  function applyTerrainState() {
    if (!map) return;
    if (window.terrainEnabled) {
      ensureTerrainSourcesAndLayers();
      map.setTerrain({ source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION });
      if (map.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', 'visible');
    } else {
      map.setTerrain(null);
      if (map.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', 'none');
    }
    updateTerrainButton();
  }

  window.toggleTerrain = function toggleTerrain(force) {
    const next = (typeof force === 'boolean') ? force : !window.terrainEnabled;
    window.terrainEnabled = next;
    try { localStorage.setItem('terrainEnabledV1', next ? '1' : '0'); } catch {}
    if (map && map.isStyleLoaded && map.isStyleLoaded()) applyTerrainState();
    else updateTerrainButton();
  };

  window.retryWebGL = function retryWebGL() {
    hideWebglFail();
    try { map?.remove?.(); } catch {}
    map = null;
    mapInitialized = false;
    try { initMap(currentStyle); } catch {}
  };


  function attachWebglRecoveryHandlers() {
    try {
      const canvas = map?.getCanvas?.();
      if (!canvas || canvas.__hasWebglRecovery) return;
      canvas.__hasWebglRecovery = true;
      canvas.addEventListener('webglcontextlost', (e) => {
        try { e.preventDefault(); } catch {}
        recoverWebglContext();
      }, false);
    } catch {}
  }

  function clearMapBoundMarkers() {
    try {
      if (window.originMarker) { window.originMarker.remove(); window.originMarker = null; }
      if (window.destMarker) { window.destMarker.remove(); window.destMarker = null; }
    } catch {}
    try { if (A?.vMarker) { A.vMarker.remove(); A.vMarker = null; } } catch {}
    try {
      (S.wps || []).forEach(w => { try { w.marker?.remove?.(); } catch {} w.marker = null; });
      (S.pois || []).forEach(p => { try { p.marker?.remove?.(); } catch {} p.marker = null; });
    } catch {}
  }

  function recoverWebglContext() {
    if (webglRecovering) return;
    if (webglFailureCount >= 1) {
      showWebglFail('WebGL perdió el contexto y el navegador bloqueó la recreación. Recarga la página (Ctrl+F5) para recuperar el mapa.');
      return;
    }
    webglRecovering = true;
    webglFailureCount += 1;
    try { if (recState?.running) stopRecording(); } catch {}
    try { if (A?.rafId) cancelAnimationFrame(A.rafId); } catch {}
    try { Object.assign(A, { running: false, paused: false, rafId: null, lastTs: null }); } catch {}

    const style = currentStyle;
    let restore = null;
    try {
      const c = map.getCenter();
      restore = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    } catch {}

    clearMapBoundMarkers();

    try { map?.remove?.(); } catch {}
    map = null;
    mapInitialized = false;

    window.__pendingRestoreView = restore;
    window.__pendingRedraw = true;
    initMap(style);
    setTimeout(() => { webglRecovering = false; }, 4000);
  }

  window.initMap = function initMap(initialStyle) {
    if (!window.maplibregl || typeof maplibregl.Map !== 'function') {
      showMaplibreLoadFail();
      return;
    }
    if (!hasWebglSupport()) {
      showWebglFail('WebGL no está disponible en este navegador/dispositivo. Activa “Aceleración por hardware” en el navegador, cierra otras pestañas con video/mapas 3D y recarga (Ctrl+F5).');
      return;
    }
    const st = (initialStyle === 'street' || initialStyle === 'satellite') ? initialStyle : 'satellite';
    currentStyle = st;
    const styleObj = st === 'street' ? STREET_STYLE : SATELLITE_STYLE;
    try {
      map = new maplibregl.Map({
        container: 'map',
        style: styleObj,
        center: [-72.590, -38.735],
        zoom: 13,
        maxZoom: MAX_MAP_ZOOM,
        pitch: 52,
        bearing: -10,
        renderWorldCopies: false,
        antialias: false
      });
    } catch (e) {
      webglFailureCount += 1;
      const msg = e?.message ? String(e.message) : '';
      if (msg.includes('maplibregl') || msg.includes('NavigationControl')) showMaplibreLoadFail();
      else showWebglFail('No se pudo inicializar WebGL (bloqueado por el navegador). Prueba recargar (Ctrl+F5) y cerrar otras pestañas con mapas o video. Si usas Chrome/Edge, verifica que la aceleración por hardware esté activada.');
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    setupMapEvents();
    attachWebglRecoveryHandlers();
    updateTerrainButton();

    map.on('load', () => {
      mapInitialized = true;
      hideWebglFail();
      document.getElementById('btn-street')?.classList.toggle('active', false);
      document.getElementById('btn-satellite')?.classList.toggle('active', true);
      document.getElementById('btn-street')?.classList.toggle('active', currentStyle === 'street');
      document.getElementById('btn-satellite')?.classList.toggle('active', currentStyle === 'satellite');
      setTimeout(() => document.getElementById('notice')?.classList.add('fade'), 2000);
      if (map.setPrefetchZoomDelta) map.setPrefetchZoomDelta(2);
      applyTerrainState();
      if (window.__pendingRestoreView) {
        try {
          const v = window.__pendingRestoreView;
          map.jumpTo({ center: v.center, zoom: Math.min(MAX_MAP_ZOOM, v.zoom), bearing: v.bearing, pitch: v.pitch });
        } catch {}
        window.__pendingRestoreView = null;
      }
      if (window.__pendingRedraw) {
        window.__pendingRedraw = false;
        try { redrawAllMapFeatures(); } catch {}
      }
    });

    map.on('error', (ev) => {
      const msg = ev?.error?.message ? String(ev.error.message) : '';
      const type = ev?.error?.type ? String(ev.error.type) : '';
      if (type === 'webglcontextcreationerror' || msg.includes('Failed to initialize WebGL')) {
        showWebglFail('No se pudo inicializar WebGL (bloqueado por el navegador). Prueba recargar (Ctrl+F5) y cerrar otras pestañas con mapas o video. Si usas Chrome/Edge, verifica que la aceleración por hardware esté activada.');
      }
      const srcId = ev?.sourceId ? String(ev.sourceId) : '';
      if (window.terrainEnabled && (srcId === 'terrain-dem' || srcId === 'hillshade-dem')) {
        window.terrainEnabled = false;
        try { localStorage.setItem('terrainEnabledV1', '0'); } catch {}
        updateTerrainButton();
      }
    });

    map.on('style.load', () => {
      if (window.terrainEnabled) {
        try { applyTerrainState(); } catch {}
      }
    });
  };

  window.setMapStyle = function setMapStyle(style) {
    if (!mapInitialized) return;
    currentStyle = style;
    const newStyle = style === 'street' ? STREET_STYLE : SATELLITE_STYLE;
    map.setStyle(newStyle);
    document.getElementById('btn-street').classList.toggle('active', style === 'street');
    document.getElementById('btn-satellite').classList.toggle('active', style === 'satellite');
    map.once('idle', redrawAllMapFeatures);
  };

  window.setRouteVisible = function setRouteVisible(visible) {
    const v = visible ? 'visible' : 'none';
    ['r-glow', 'r-main', 'r-trace', 'r-alt-glow', 'r-alt-main'].forEach(id => {
      try {
        if (map?.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', v);
      } catch {}
    });
  };

  window.redrawAllMapFeatures = function redrawAllMapFeatures() {
    if (!map || !map.isStyleLoaded || !map.isStyleLoaded()) return;
    if (S.routes.length && S.routes[S.activeRoute]?.coords) drawAllRoutes();
    if (S.origin?.coords) {
      if (window.originMarker) window.originMarker.remove();
      const el = document.createElement('div');
      el.className = 'mrkr-origin';
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(S.origin.coords).addTo(map);
      m.on('dragend', () => {
        const lnglat = m.getLngLat();
        S.origin = { coords: [lnglat.lng, lnglat.lat], marker: m };
        showCoord('origin', [lnglat.lng, lnglat.lat]);
        if (S.routes.length) calcRoutes();
      });
      window.originMarker = m;
      S.origin.marker = m;
    }
    if (S.dest?.coords) {
      if (window.destMarker) window.destMarker.remove();
      const el = document.createElement('div');
      el.className = 'mrkr-dest';
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(S.dest.coords).addTo(map);
      m.on('dragend', () => {
        const lnglat = m.getLngLat();
        S.dest = { coords: [lnglat.lng, lnglat.lat], marker: m };
        showCoord('dest', [lnglat.lng, lnglat.lat]);
        if (S.routes.length) calcRoutes();
      });
      window.destMarker = m;
      S.dest.marker = m;
    }
    S.wps.forEach(wp => {
      if (wp.marker) wp.marker.remove();
      const wrap = document.createElement('div');
      wrap.className = 'mrkr-wp-wrap';
      const dot = document.createElement('div');
      dot.className = 'mrkr-wp';
      wrap.appendChild(dot);
      const m = new maplibregl.Marker({ element: wrap, draggable: true, anchor: 'center' }).setLngLat(wp.coords).addTo(map);
      wrap.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        const i = S.wps.indexOf(wp);
        if (i !== -1) {
          S.wps.splice(i, 1);
          m.remove();
          calcRoutes();
          updateWpList();
        }
      });
      m.on('dragend', () => {
        wp.coords = [m.getLngLat().lng, m.getLngLat().lat];
        calcRoutes();
      });
      wp.marker = m;
    });
    S.pois.forEach(p => {
      if (p.marker) p.marker.remove();
      createPoiMarker(p);
    });
  };

  window.drawAllRoutes = function drawAllRoutes() {
    if (!map || !map.isStyleLoaded || !map.isStyleLoaded()) return;
    ['r-glow', 'r-main', 'r-trace', 'r-alt-glow', 'r-alt-main'].forEach(id => {
      if (map.getLayer && map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource && map.getSource('route-full')) map.removeSource('route-full');
    if (map.getSource && map.getSource('route-trace')) map.removeSource('route-trace');
    if (map.getSource && map.getSource('route-alt')) map.removeSource('route-alt');
    if (!S.routes[S.activeRoute]) return;

    map.addSource('route-full', {
      type: 'geojson',
      lineMetrics: true,
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: S.routes[S.activeRoute].coords } }
    });
    map.addSource('route-trace', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });

    map.addLayer({
      id: 'r-glow',
      type: 'line',
      source: 'route-full',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 18,
        'line-opacity': 0.16,
        'line-blur': 10,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#00f082', 0.5, '#ffc840', 1, '#ff3055']
      }
    });
    map.addLayer({
      id: 'r-main',
      type: 'line',
      source: 'route-full',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 4,
        'line-opacity': 0.95,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#00f082', 0.5, '#ffc840', 1, '#ff3055']
      }
    });
    map.addLayer({
      id: 'r-trace',
      type: 'line',
      source: 'route-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00d2ff', 'line-width': 5, 'line-opacity': 0.95 }
    });

    if (S.routes.length > 1) {
      const altCoords = S.routes.filter((_, i) => i !== S.activeRoute).map(r => r.coords);
      if (altCoords.length) {
        map.addSource('route-alt', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: altCoords.map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } })) }
        });
        map.addLayer({
          id: 'r-alt-glow',
          type: 'line',
          source: 'route-alt',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#666666', 'line-width': 12, 'line-opacity': 0.22, 'line-blur': 5 }
        });
        map.addLayer({
          id: 'r-alt-main',
          type: 'line',
          source: 'route-alt',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#555555', 'line-width': 2.5, 'line-opacity': 0.55 }
        });
      }
    }
    if (S.layers?.route === false) setRouteVisible(false);
  };

})();
