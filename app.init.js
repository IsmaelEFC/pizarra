(function () {
  function initUi() {
    const slider = document.getElementById('spd-slider');
    const lbl = document.getElementById('spd-val');
    const upd = () => { lbl.textContent = `${(parseFloat(slider.value) || 1).toFixed(1)}×`; };
    slider.addEventListener('input', upd);
    upd();
    const badge = document.getElementById('rec-badge');
    if (badge) badge.style.display = 'none';

    if (!document.body.dataset.speedHotkeysBound) {
      document.body.dataset.speedHotkeysBound = '1';
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (document.body.classList.contains('modal-open')) return;
        const tag = String(document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        const s = document.getElementById('spd-slider');
        if (!s) return;
        const min = parseFloat(s.min) || 0.1;
        const max = parseFloat(s.max) || 10;
        const step = e.shiftKey ? 0.5 : (parseFloat(s.step) || 0.1);
        const cur = parseFloat(s.value) || 1;
        const next = e.key === 'ArrowUp' ? (cur + step) : (cur - step);
        s.value = String(Math.max(min, Math.min(max, Math.round(next * 10) / 10)));
        s.dispatchEvent(new Event('input', { bubbles: true }));
        try { e.preventDefault(); } catch {}
      });
    }
  }

  function boot() {
    initUi();
    initMap();
    setupSearch('si-origin', 'sd-origin', 'origin');
    setupSearch('si-dest', 'sd-dest', 'dest');
    updateWpList();
    updatePoiList();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
