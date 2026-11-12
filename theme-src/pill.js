/**
 * PVB Pill: floating pill + lazy panel loader.
 * Requires core.js to run first (via window.__pvb).
 * Loads panel.js on demand when opened.
 */
(function () {
  'use strict';

  if (window.__pvbPill) return;
  window.__pvbPill = true;

  var pvb = window.__pvb;
  if (!pvb) return;

  var panelLoading = false;
  var panelLoaded = false;
  var panelUrl = '';
  var pendingOpen = false;

  function initPill() {
    var drawer = document.querySelector('[data-pvb-drawer]');
    if (!drawer) return;

    var pill = drawer.querySelector('.pvb-pill');
    var pillBadge = drawer.querySelector('.pvb-pill-badge');
    var pillLabel = drawer.querySelector('.pvb-pill-label');
    if (!pill) return;

    var dataMax = parseInt(drawer.dataset.maxItems, 10);
    if (dataMax > 0) pvb.setMaxItems(dataMax);
    panelUrl = drawer.dataset.panelAssetUrl || '';
    var originalLabel = pillLabel ? pillLabel.textContent : '';

    function updatePill() {
      var count = pvb.getCount();
      if (pillBadge) pillBadge.textContent = count;
      pill.hidden = count === 0;
      pill.setAttribute('aria-expanded', 'false');
    }

    function loadPanel(callback) {
      if (panelLoaded) { callback(); return; }
      if (panelLoading) { pendingOpen = true; return; }
      if (!panelUrl) return;

      panelLoading = true;
      pendingOpen = true;
      pill.disabled = true;
      if (pillLabel) pillLabel.textContent = 'Loading...';

      var script = document.createElement('script');
      script.src = panelUrl;
      script.onload = function () {
        panelLoading = false;
        panelLoaded = true;
        pill.disabled = false;
        if (pillLabel) pillLabel.textContent = originalLabel;
        if (pendingOpen) {
          pendingOpen = false;
          callback();
        }
      };
      script.onerror = function () {
        panelLoading = false;
        pendingOpen = false;
        pill.disabled = false;
        if (pillLabel) pillLabel.textContent = originalLabel;
        if (typeof console !== 'undefined' && console.error) {
          console.error('[PVB] Panel load failed');
        }
      };
      document.head.appendChild(script);
    }

    function preloadPanel() {
      if (panelLoaded || panelLoading || !panelUrl) return;
      panelLoading = true;
      var script = document.createElement('script');
      script.src = panelUrl;
      script.onload = function () {
        panelLoading = false;
        panelLoaded = true;
      };
      script.onerror = function () {
        panelLoading = false;
      };
      document.head.appendChild(script);
    }

    function openPanel() {
      if (panelLoaded && window.__pvbPanel) {
        window.__pvbPanel.open();
      } else {
        loadPanel(function () {
          if (window.__pvbPanel) window.__pvbPanel.open();
        });
      }
    }

    pill.addEventListener('click', openPanel);

    // Preload on hover/touch/focus
    pill.addEventListener('pointerenter', preloadPanel, { once: true });
    pill.addEventListener('touchstart', preloadPanel, { once: true, passive: true });
    pill.addEventListener('focus', preloadPanel, { once: true });

    // Preload after first save
    var preloadedAfterSave = false;
    window.addEventListener('pvb:saved', function () {
      updatePill();
      if (!preloadedAfterSave) {
        preloadedAfterSave = true;
        if (window.requestIdleCallback) {
          window.requestIdleCallback(preloadPanel);
        } else {
          setTimeout(preloadPanel, 200);
        }
      }
    });

    window.addEventListener('pvb:removed', updatePill);
    window.addEventListener('pvb:open-drawer', openPanel);

    updatePill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPill);
  } else {
    initPill();
  }
})();
