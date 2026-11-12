/**
 * PVB Drawer: pill + drawer + Add All to Cart.
 * Requires core.js to run first (via window.__pvb).
 */
(function () {
  'use strict';

  if (window.__pvbDrawer) return;
  window.__pvbDrawer = true;

  var pvb = window.__pvb;
  if (!pvb) return;

  var renderGeneration = 0;

  function initDrawer() {
    var drawer = document.querySelector('[data-pvb-drawer]');
    if (!drawer) return;
    var q = function(s) { return drawer.querySelector(s); };

    var pill = q('.pvb-pill');
    var pillBadge = q('.pvb-pill-badge');
    var overlay = q('.pvb-drawer-overlay');
    var panel = q('.pvb-drawer-panel');
    var closeBtn = q('.pvb-drawer-close');
    var itemsList = q('.pvb-drawer-items');
    var emptyState = q('.pvb-drawer-empty');
    var sublineCount = q('.pvb-subline-count');
    var sublineTotal = q('.pvb-subline-total');
    var cartBtn = q('.pvb-cart-btn');
    var cartError = q('.pvb-cart-error');

    if (!pill || !panel || !overlay) return;

    var dataMax = parseInt(drawer.dataset.maxItems, 10);
    if (dataMax > 0) pvb.setMaxItems(dataMax);
    var moneyFormat = drawer.dataset.moneyFormat || '{{amount}}';
    var cartAddUrl = drawer.dataset.cartAddUrl || '/cart/add.js';
    var cartJsonUrl = drawer.dataset.cartJsonUrl || '/cart.js';
    var cartUrl = drawer.dataset.cartUrl || '/cart';
    var shareAssetUrl = drawer.dataset.shareAssetUrl || '';
    var lastFocused = null;
    var currentPrices = {};
    var shareLoading = false;
    var shareLoaded = false;
    var shareLabel = drawer.dataset.shareLabel || 'Get a Second Opinion';

    var shareBtn = q('.pvb-share-btn');
    var shareError = q('.pvb-share-error');

    panel.setAttribute('tabindex', '-1');

    function showSkeletons(count) {
      if (!itemsList) return;
      itemsList.innerHTML = '';
      for (var i = 0; i < count; i++) {
        var skeleton = document.createElement('li');
        skeleton.className = 'pvb-item-skeleton';
        skeleton.innerHTML =
          '<div class="pvb-skeleton-image"></div>' +
          '<div class="pvb-skeleton-details">' +
            '<div class="pvb-skeleton-line"></div>' +
            '<div class="pvb-skeleton-line"></div>' +
          '</div>';
        itemsList.appendChild(skeleton);
      }
    }

    function updateSubline() {
      var items = pvb.getItems();
      var count = items.length;
      var total = 0;

      var sublineWrap = q('.pvb-subline');
      if (sublineWrap) sublineWrap.hidden = count === 0;

      items.forEach(function (item) {
        if (currentPrices[item.variantId]) {
          total += currentPrices[item.variantId];
        }
      });

      if (sublineCount) {
        sublineCount.textContent = count === 1 ? '1 piece' : count + ' pieces';
      }
      if (sublineTotal) {
        sublineTotal.textContent = pvb.formatMoney(total, moneyFormat);
      }
    }

    function renderItems() {
      var items = pvb.getItems();
      var count = items.length;

      if (pillBadge) pillBadge.textContent = count;
      pill.hidden = count === 0;
      pill.setAttribute('aria-expanded', overlay.dataset.open === 'true' ? 'true' : 'false');

      if (emptyState) emptyState.dataset.visible = count === 0 ? 'true' : 'false';
      if (cartBtn) cartBtn.hidden = count === 0;
      if (cartError) cartError.dataset.visible = 'false';

      if (count === 0) {
        if (itemsList) itemsList.innerHTML = '';
        currentPrices = {};
        updateSubline();
        return;
      }

      showSkeletons(count);

      var thisRender = ++renderGeneration;

      var fetchPromises = items.map(function (item) {
        return pvb.fetchProduct(item.handle).then(function (product) {
          return { item: item, product: product };
        });
      });

      Promise.all(fetchPromises).then(function (results) {
        if (thisRender !== renderGeneration) return;

        var fragment = document.createDocumentFragment();
        currentPrices = {};

        results.forEach(function (result) {
          var item = result.item;
          var product = result.product;

          if (!product) return;

          var variant = pvb.findVariant(product, item.variantId);
          if (!variant) {
            variant = { title: '', price: product.price };
          }

          currentPrices[item.variantId] = variant.price;

          var imgUrl = '';
          if (variant.featured_image && variant.featured_image.src) {
            imgUrl = variant.featured_image.src;
          } else if (product.featured_image) {
            imgUrl = product.featured_image;
          }

          var li = document.createElement('li');
          li.className = 'pvb-item';
          li.dataset.variantId = item.variantId;

          li.innerHTML =
            '<div class="pvb-item-image-wrap">' +
              '<img class="pvb-item-image" src="' + pvb.escapeHtml(pvb.safeImageUrl(imgUrl)) + '" alt="" loading="lazy">' +
              '<button type="button" class="pvb-item-heart" data-variant-id="' + pvb.escapeHtml(item.variantId) + '" aria-label="Remove ' + pvb.escapeHtml(product.title) + ' from your board">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="pvb-item-details">' +
              '<p class="pvb-item-title">' + pvb.escapeHtml(product.title) + '</p>' +
              (variant.title && variant.title !== 'Default Title'
                ? '<p class="pvb-item-variant">' + pvb.escapeHtml(variant.title) + '</p>'
                : '') +
              '<p class="pvb-item-price">' + pvb.formatMoney(variant.price, moneyFormat) + '</p>' +
            '</div>';

          fragment.appendChild(li);
        });

        if (itemsList) {
          itemsList.innerHTML = '';
          itemsList.appendChild(fragment);
        }

        updateSubline();
      });
    }

    function openDrawer() {
      lastFocused = document.activeElement;
      overlay.dataset.open = 'true';
      pill.setAttribute('aria-expanded', 'true');
      panel.focus();
      pvb.dispatchEvent('pvb:drawer-open', { count: pvb.getCount() });
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

    function addAllToCart() {
      var items = pvb.getItems();
      if (items.length === 0) return;

      if (cartBtn.disabled) return;
      cartBtn.disabled = true;
      var originalLabel = cartBtn.textContent;
      cartBtn.textContent = 'Adding...';
      if (cartError) cartError.dataset.visible = 'false';

      fetch(cartJsonUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('cart fetch failed');
          return res.json();
        })
        .then(function (cart) {
          var inCart = {};
          if (cart && cart.items) {
            cart.items.forEach(function (item) {
              inCart[String(item.variant_id)] = true;
            });
          }

          var toAdd = items.filter(function (item) {
            return !inCart[item.variantId];
          });

          if (toAdd.length === 0) {
            window.location.href = cartUrl;
            return;
          }

          var payload = {
            items: toAdd.map(function (item) {
              return { id: item.variantId, quantity: 1 };
            })
          };

          return fetch(cartAddUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function (res) {
            if (!res.ok) throw new Error('cart add failed');
            window.location.href = cartUrl;
          });
        })
        .catch(function (err) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[PVB] Cart error:', err.message || err);
          }
          cartBtn.disabled = false;
          cartBtn.textContent = originalLabel;
          if (cartError) cartError.dataset.visible = 'true';
        });
    }

    function loadShareScript() {
      if (shareLoaded || shareLoading || !shareAssetUrl) return;

      shareLoading = true;
      if (shareBtn) {
        shareBtn.disabled = true;
        shareBtn.textContent = 'Loading...';
      }

      var script = document.createElement('script');
      script.src = shareAssetUrl;
      script.onload = function () {
        shareLoading = false;
        shareLoaded = true;
        if (shareBtn) {
          shareBtn.disabled = false;
          shareBtn.textContent = shareLabel;
        }
        pvb.dispatchEvent('pvb:share-request', {});
      };
      script.onerror = function () {
        shareLoading = false;
        if (shareBtn) {
          shareBtn.disabled = false;
          shareBtn.textContent = shareLabel;
        }
        if (shareError) {
          shareError.textContent = 'Something went wrong. Try again in a moment.';
          shareError.dataset.visible = 'true';
        }
      };
      document.head.appendChild(script);
    }

    function handleShareClick() {
      if (shareError) shareError.dataset.visible = 'false';
      if (shareLoaded) {
        pvb.dispatchEvent('pvb:share-request', {});
      } else {
        loadShareScript();
      }
    }

    pill.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDrawer();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.dataset.open === 'true') closeDrawer();
      if (e.key === 'Tab' && overlay.dataset.open === 'true') trapFocus(e);
    });

    if (itemsList) {
      itemsList.addEventListener('click', function (e) {
        var heartBtn = e.target.closest('.pvb-item-heart');
        if (heartBtn) {
          var variantId = heartBtn.dataset.variantId;
          pvb.removeItem(variantId);
        }
      });
    }

    if (cartBtn) {
      cartBtn.addEventListener('click', addAllToCart);
    }

    if (shareBtn) {
      shareBtn.disabled = false;
      shareBtn.addEventListener('click', handleShareClick);
    }

    function renderSharedRow() {
      var footer = q('.pvb-drawer-footer'), row = q('.pvb-shared-row'), h, e;
      if (!footer) return;
      try { h = JSON.parse(localStorage.getItem('pvb:shares:v1') || '[]'); } catch (x) { h = []; }
      if (!h.length) { if (row) row.dataset.visible = 'false'; return; }
      e = h[0];
      if (!row) { row = document.createElement('div'); row.className = 'pvb-shared-row'; footer.prepend(row); }
      var base = window.location.origin + ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/') + 'apps/board/';
      var link = e.resultsUrl && e.resultsUrl.indexOf(base) === 0 ? ' · <a class="pvb-shared-link" href="' + pvb.escapeHtml(e.resultsUrl) + '">View results</a>' : '';
      row.innerHTML = '<span class="pvb-shared-icon">&#10003;</span><span class="pvb-shared-text">Shared with ' + pvb.escapeHtml(e.partnerFirstName || '') + '</span>' + link;
      row.dataset.visible = 'true';
    }

    window.addEventListener('pvb:saved', renderItems);
    window.addEventListener('pvb:removed', renderItems);
    window.addEventListener('pvb:open-drawer', openDrawer);
    window.addEventListener('pvb:shared', renderSharedRow);

    renderItems();
    renderSharedRow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrawer);
  } else {
    initDrawer();
  }
})();
