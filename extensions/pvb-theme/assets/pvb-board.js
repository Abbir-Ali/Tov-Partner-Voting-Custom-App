/**
 * PVB Board: unified module for storage, events, save button, pill, and drawer.
 * Loaded once by Shopify even if both blocks are on the page.
 */
(function () {
  'use strict';

  // Guard against double init
  if (window.__pvbInit) return;
  window.__pvbInit = true;

  var STORAGE_KEY = 'pvb:board:v1';
  var board = { items: [] };
  var maxItems = 12; // last-resort default
  var inMemoryOnly = false;
  var productCache = {};
  var productFetchPromises = {}; // dedupe in-flight requests
  var renderGeneration = 0; // race-safe render tracking

  // ─── Storage ───────────────────────────────────────────────────────────────

  function loadBoard() {
    if (inMemoryOnly) return;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          board = parsed;
        } else {
          board = { items: [] };
          saveBoard();
        }
      }
    } catch (e) {
      // Clear bad data and fall back to in-memory
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage unavailable */ }
      board = { items: [] };
      inMemoryOnly = true;
    }
  }

  function saveBoard() {
    if (inMemoryOnly) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    } catch (e) {
      inMemoryOnly = true;
    }
  }

  function setMaxItems(n) {
    if (typeof n === 'number' && n > 0) {
      maxItems = n;
    }
  }

  function getItems() {
    return board.items.slice();
  }

  function getCount() {
    return board.items.length;
  }

  function hasItem(variantId) {
    return board.items.some(function (item) {
      return item.variantId === variantId;
    });
  }

  function addItem(item) {
    if (!item || !item.variantId) return { ok: false, reason: 'invalid' };
    if (hasItem(item.variantId)) return { ok: false, reason: 'duplicate' };
    if (board.items.length >= maxItems) return { ok: false, reason: 'full' };

    board.items.push({
      variantId: String(item.variantId),
      productId: String(item.productId || ''),
      handle: String(item.handle || ''),
      addedAt: Date.now()
    });
    saveBoard();
    dispatchEvent('pvb:saved', { variantId: item.variantId, count: getCount() });
    return { ok: true };
  }

  function removeItem(variantId) {
    var idx = board.items.findIndex(function (item) {
      return item.variantId === variantId;
    });
    if (idx === -1) return { ok: false, reason: 'not_found' };

    board.items.splice(idx, 1);
    saveBoard();
    dispatchEvent('pvb:removed', { variantId: variantId, count: getCount() });
    return { ok: true };
  }

  function dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  // ─── Product Fetch ─────────────────────────────────────────────────────────

  function getShopifyRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  }

  function fetchProduct(handle) {
    if (!handle) return Promise.resolve(null);

    // Return cached result
    if (productCache[handle]) {
      return Promise.resolve(productCache[handle]);
    }

    // Dedupe in-flight requests
    if (productFetchPromises[handle]) {
      return productFetchPromises[handle];
    }

    // Sanitize handle (lowercase alphanumeric + hyphen only)
    var safeHandle = handle.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!safeHandle) return Promise.resolve(null);

    var url = getShopifyRoot() + 'products/' + encodeURIComponent(safeHandle) + '.js';
    var promise = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(function (data) {
        productCache[handle] = data;
        delete productFetchPromises[handle];
        return data;
      })
      .catch(function () {
        // Cache null for failed fetches to avoid retrying
        productCache[handle] = null;
        delete productFetchPromises[handle];
        return null;
      });

    productFetchPromises[handle] = promise;
    return promise;
  }

  function findVariant(product, variantId) {
    if (!product || !product.variants) return null;
    return product.variants.find(function (v) {
      return String(v.id) === String(variantId);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeImageUrl(url) {
    if (!url) return '';
    if (url.indexOf('https://') === 0 || url.indexOf('/') === 0) {
      return url;
    }
    return '';
  }

  /**
   * Format cents into a price string using Shopify money format.
   * Supports all standard placeholders with optional whitespace.
   */
  function formatMoney(cents, format) {
    var value = cents / 100;
    var rounded = Math.round(value);

    // Add thousand separators
    function addSeparator(num, sep) {
      return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    }

    var intPart = Math.floor(value);
    var decPart = value.toFixed(2).split('.')[1];

    // Shopify format definitions (input: cents)
    // amount -> 1,134.65 (comma thousands, period decimal)
    var amount = addSeparator(intPart, ',') + '.' + decPart;
    // amount_no_decimals -> 1,135 (rounded, comma thousands)
    var amountNoDecimals = addSeparator(rounded, ',');
    // amount_with_comma_separator -> 1.134,65 (period thousands, comma decimal)
    var amountWithCommaSeparator = addSeparator(intPart, '.') + ',' + decPart;
    // amount_no_decimals_with_comma_separator -> 1.135 (rounded, period thousands)
    var amountNoDecimalsWithCommaSeparator = addSeparator(rounded, '.');
    // amount_with_space_separator -> 1 134,65 (space thousands, comma decimal)
    var amountWithSpaceSeparator = addSeparator(intPart, ' ') + ',' + decPart;
    // amount_with_period_and_space_separator -> 1 134.65 (space thousands, period decimal)
    var amountWithPeriodAndSpaceSeparator = addSeparator(intPart, ' ') + '.' + decPart;
    // amount_with_apostrophe_separator -> 1'134.65 (apostrophe thousands, period decimal)
    var amountWithApostropheSeparator = addSeparator(intPart, "'") + '.' + decPart;
    // amount_no_decimals_with_space_separator -> 1 135 (rounded, space thousands)
    var amountNoDecimalsWithSpaceSeparator = addSeparator(rounded, ' ');

    return (format || '{{amount}}')
      .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, amountNoDecimalsWithCommaSeparator)
      .replace(/\{\{\s*amount_no_decimals_with_space_separator\s*\}\}/g, amountNoDecimalsWithSpaceSeparator)
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, amountWithCommaSeparator)
      .replace(/\{\{\s*amount_with_space_separator\s*\}\}/g, amountWithSpaceSeparator)
      .replace(/\{\{\s*amount_with_period_and_space_separator\s*\}\}/g, amountWithPeriodAndSpaceSeparator)
      .replace(/\{\{\s*amount_with_apostrophe_separator\s*\}\}/g, amountWithApostropheSeparator)
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, amountNoDecimals)
      .replace(/\{\{\s*amount\s*\}\}/g, amount);
  }

  // ─── Save Button ───────────────────────────────────────────────────────────

  function initSaveButton() {
    var wrapper = document.querySelector('[data-pvb-save-button]');
    if (!wrapper) return;

    var btn = wrapper.querySelector('.pvb-heart-btn');
    var labelEl = wrapper.querySelector('.pvb-btn-label');
    if (!btn) return;

    var productId = wrapper.dataset.productId;
    var handle = wrapper.dataset.productHandle;
    var labelSave = wrapper.dataset.labelSave || 'Save to Board';
    var labelSaved = wrapper.dataset.labelSaved || 'Saved to Board';
    var dataMax = parseInt(wrapper.dataset.maxItems, 10);
    if (dataMax > 0) setMaxItems(dataMax);

    function getCurrentVariantId() {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return null;
      var input = form.querySelector('[name="id"]');
      return input ? input.value : null;
    }

    function updateState() {
      var variantId = getCurrentVariantId();
      if (!variantId) return;

      var saved = hasItem(variantId);
      var full = getCount() >= maxItems && !saved;

      btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      btn.setAttribute('aria-label', saved ? labelSaved : labelSave);
      if (labelEl) labelEl.textContent = saved ? labelSaved : labelSave;
      wrapper.dataset.full = full ? 'true' : 'false';
    }

    btn.addEventListener('click', function () {
      var variantId = getCurrentVariantId();
      if (!variantId) return;

      if (hasItem(variantId)) {
        removeItem(variantId);
      } else {
        var result = addItem({
          variantId: variantId,
          productId: productId,
          handle: handle
        });
        if (!result.ok && result.reason === 'full') {
          wrapper.dataset.full = 'true';
          return;
        }
      }
      updateState();
    });

    // Variant changes
    var form = document.querySelector('form[action*="/cart/add"]');
    if (form) {
      form.addEventListener('change', updateState);
    }
    window.addEventListener('popstate', updateState);
    window.addEventListener('pvb:removed', updateState);
    window.addEventListener('pvb:saved', updateState);

    updateState();
  }

  // ─── Drawer ────────────────────────────────────────────────────────────────

  function initDrawer() {
    var drawer = document.querySelector('[data-pvb-drawer]');
    if (!drawer) return;

    var pill = drawer.querySelector('.pvb-pill');
    var pillCount = drawer.querySelector('.pvb-pill-count');
    var overlay = drawer.querySelector('.pvb-drawer-overlay');
    var panel = drawer.querySelector('.pvb-drawer-panel');
    var closeBtn = drawer.querySelector('.pvb-drawer-close');
    var itemsList = drawer.querySelector('.pvb-drawer-items');
    var emptyMsg = drawer.querySelector('.pvb-drawer-empty');

    if (!pill || !panel) return;

    var dataMax = parseInt(drawer.dataset.maxItems, 10);
    if (dataMax > 0) setMaxItems(dataMax);
    var moneyFormat = drawer.dataset.moneyFormat || '{{amount}}';
    var lastFocused = null;

    panel.setAttribute('tabindex', '-1');

    function renderItems() {
      var items = getItems();
      var count = items.length;

      // Update pill count and visibility
      if (pillCount) pillCount.textContent = count;
      pill.hidden = count === 0;
      pill.setAttribute('aria-expanded', overlay.dataset.open === 'true' ? 'true' : 'false');

      // Show/hide empty message
      if (emptyMsg) emptyMsg.style.display = count === 0 ? 'block' : 'none';

      if (count === 0) {
        if (itemsList) itemsList.innerHTML = '';
        return;
      }

      // Increment render generation to ignore stale renders
      var thisRender = ++renderGeneration;

      // Fetch all products in parallel
      var fetchPromises = items.map(function (item) {
        return fetchProduct(item.handle).then(function (product) {
          return { item: item, product: product };
        });
      });

      Promise.all(fetchPromises).then(function (results) {
        // Ignore if a newer render started
        if (thisRender !== renderGeneration) return;

        var fragment = document.createDocumentFragment();

        results.forEach(function (result) {
          var item = result.item;
          var product = result.product;

          // Skip items with failed product fetch
          if (!product) return;

          var variant = findVariant(product, item.variantId);
          if (!variant) {
            variant = { title: '', price: product.price };
          }

          var imgUrl = product.featured_image
            || (variant.featured_image ? variant.featured_image.src : '');

          var li = document.createElement('li');
          li.className = 'pvb-item';
          li.dataset.variantId = item.variantId;

          li.innerHTML =
            '<img class="pvb-item-image" src="' + escapeHtml(safeImageUrl(imgUrl)) + '" alt="" loading="lazy">' +
            '<div class="pvb-item-details">' +
              '<span class="pvb-item-title">' + escapeHtml(product.title) + '</span>' +
              (variant.title && variant.title !== 'Default Title'
                ? '<span class="pvb-item-variant">' + escapeHtml(variant.title) + '</span>'
                : '') +
              '<span class="pvb-item-price">' + formatMoney(variant.price, moneyFormat) + '</span>' +
            '</div>' +
            '<button type="button" class="pvb-item-remove" data-variant-id="' + escapeHtml(item.variantId) + '" aria-label="Remove ' + escapeHtml(product.title) + '">' +
              'Remove' +
            '</button>';

          fragment.appendChild(li);
        });

        // Replace list contents in one operation
        if (itemsList) {
          itemsList.innerHTML = '';
          itemsList.appendChild(fragment);
        }
      });
    }

    function openDrawer() {
      lastFocused = document.activeElement;
      overlay.dataset.open = 'true';
      pill.setAttribute('aria-expanded', 'true');
      panel.focus();
      dispatchEvent('pvb:drawer-open', { count: getCount() });
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      overlay.dataset.open = 'false';
      pill.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (lastFocused) {
        lastFocused.focus();
        lastFocused = null;
      }
    }

    function trapFocus(e) {
      if (overlay.dataset.open !== 'true') return;
      var focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    pill.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDrawer();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.dataset.open === 'true') {
        closeDrawer();
      }
      if (e.key === 'Tab' && overlay.dataset.open === 'true') {
        trapFocus(e);
      }
    });

    if (itemsList) {
      itemsList.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('.pvb-item-remove');
        if (removeBtn) {
          var variantId = removeBtn.dataset.variantId;
          removeItem(variantId);
          // Event listener handles renderItems, no explicit call needed
        }
      });
    }

    window.addEventListener('pvb:saved', renderItems);
    window.addEventListener('pvb:removed', renderItems);

    renderItems();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    loadBoard();
    initSaveButton();
    initDrawer();
  }

  // Run init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API for debugging
  window.PVBBoard = {
    setMaxItems: setMaxItems,
    getItems: getItems,
    getCount: getCount,
    hasItem: hasItem,
    addItem: addItem,
    removeItem: removeItem
  };
})();
