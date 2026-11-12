/**
 * PVB Core: storage, events, helpers, max-items logic.
 * Shared state via window.__pvb to work when both bundles load.
 */
(function () {
  'use strict';

  if (window.__pvb) return;

  var STORAGE_KEY = 'pvb:board:v1';
  var board = { items: [] };
  var maxItems = 12;
  var inMemoryOnly = false;
  var productCache = {};
  var productFetchPromises = {};

  // Storage
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
    if (typeof n === 'number' && n > 0) maxItems = n;
  }

  function getMaxItems() {
    return maxItems;
  }

  function getItems() {
    return board.items.slice();
  }

  function getCount() {
    return board.items.length;
  }

  function hasItem(variantId) {
    var numericId = toNumericId(variantId);
    return board.items.some(function (item) {
      return toNumericId(item.variantId) === numericId;
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
    var numericId = toNumericId(variantId);
    var idx = board.items.findIndex(function (item) {
      return toNumericId(item.variantId) === numericId;
    });
    if (idx === -1) return { ok: false, reason: 'not_found' };

    board.items.splice(idx, 1);
    saveBoard();
    dispatchEvent('pvb:removed', { variantId: numericId, count: getCount() });
    return { ok: true };
  }

  function dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  // Product fetch with cache
  function getShopifyRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  }

  function fetchProduct(handle) {
    if (!handle) return Promise.resolve(null);
    if (productCache[handle]) return Promise.resolve(productCache[handle]);
    if (productFetchPromises[handle]) return productFetchPromises[handle];

    var safeHandle = handle.toLowerCase().replace(/[^a-z0-9_-]/g, '');
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
        productCache[handle] = null;
        delete productFetchPromises[handle];
        return null;
      });

    productFetchPromises[handle] = promise;
    return promise;
  }

  function findVariant(product, variantId) {
    if (!product || !product.variants) return null;
    var numericId = toNumericId(variantId);
    return product.variants.find(function (v) {
      return toNumericId(v.id) === numericId;
    });
  }

  // Helpers
  function toNumericId(id) {
    if (!id) return '';
    var str = String(id);
    // GID format: gid://shopify/ProductVariant/12345 -> extract trailing digits
    var match = str.match(/(\d+)$/);
    return match ? match[1] : str;
  }

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
    try {
      var parsed = new URL(url, window.location.origin);
      if (parsed.protocol !== 'https:') return '';
      var host = parsed.host;
      var path = parsed.pathname;
      var isShopifyCdn = host === 'cdn.shopify.com';
      var isSameHost = host === window.location.host;
      var validPath = path.indexOf('/cdn/') === 0 || path.indexOf('/s/files/') === 0;
      if (isShopifyCdn || (isSameHost && validPath)) {
        return parsed.href;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function formatMoney(cents, format) {
    var value = cents / 100;
    var rounded = Math.round(value);

    function addSep(num, sep) {
      return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    }

    var intPart = Math.floor(value);
    var decPart = value.toFixed(2).split('.')[1];

    var amt = addSep(intPart, ',') + '.' + decPart;
    var amtNoDec = addSep(rounded, ',');
    var amtComma = addSep(intPart, '.') + ',' + decPart;
    var amtNoDecComma = addSep(rounded, '.');
    var amtSpace = addSep(intPart, ' ') + ',' + decPart;
    var amtPeriodSpace = addSep(intPart, ' ') + '.' + decPart;
    var amtApos = addSep(intPart, "'") + '.' + decPart;
    var amtNoDecSpace = addSep(rounded, ' ');

    return (format || '{{amount}}')
      .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, amtNoDecComma)
      .replace(/\{\{\s*amount_no_decimals_with_space_separator\s*\}\}/g, amtNoDecSpace)
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, amtComma)
      .replace(/\{\{\s*amount_with_space_separator\s*\}\}/g, amtSpace)
      .replace(/\{\{\s*amount_with_period_and_space_separator\s*\}\}/g, amtPeriodSpace)
      .replace(/\{\{\s*amount_with_apostrophe_separator\s*\}\}/g, amtApos)
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, amtNoDec)
      .replace(/\{\{\s*amount\s*\}\}/g, amt);
  }

  loadBoard();

  window.__pvb = {
    setMaxItems: setMaxItems,
    getMaxItems: getMaxItems,
    getItems: getItems,
    getCount: getCount,
    hasItem: hasItem,
    addItem: addItem,
    removeItem: removeItem,
    dispatchEvent: dispatchEvent,
    fetchProduct: fetchProduct,
    findVariant: findVariant,
    toNumericId: toNumericId,
    escapeHtml: escapeHtml,
    safeImageUrl: safeImageUrl,
    formatMoney: formatMoney
  };

  window.PVBBoard = window.__pvb;
})();
