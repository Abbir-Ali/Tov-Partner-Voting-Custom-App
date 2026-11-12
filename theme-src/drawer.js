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

    var pill = drawer.querySelector('.pvb-pill');
    var pillBadge = drawer.querySelector('.pvb-pill-badge');
    var overlay = drawer.querySelector('.pvb-drawer-overlay');
    var panel = drawer.querySelector('.pvb-drawer-panel');
    var closeBtn = drawer.querySelector('.pvb-drawer-close');
    var itemsList = drawer.querySelector('.pvb-drawer-items');
    var emptyState = drawer.querySelector('.pvb-drawer-empty');
    var sublineCount = drawer.querySelector('.pvb-subline-count');
    var sublineTotal = drawer.querySelector('.pvb-subline-total');
    var cartBtn = drawer.querySelector('.pvb-cart-btn');
    var cartError = drawer.querySelector('.pvb-cart-error');

    if (!pill || !panel || !overlay) return;

    var dataMax = parseInt(drawer.dataset.maxItems, 10);
    if (dataMax > 0) pvb.setMaxItems(dataMax);
    var moneyFormat = drawer.dataset.moneyFormat || '{{amount}}';
    var cartAddUrl = drawer.dataset.cartAddUrl || '/cart/add.js';
    var cartJsonUrl = drawer.dataset.cartJsonUrl || '/cart.js';
    var cartUrl = drawer.dataset.cartUrl || '/cart';
    var lastFocused = null;
    var currentPrices = {};

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

      // Hide subline when board is empty
      var sublineWrap = drawer.querySelector('.pvb-subline');
      if (sublineWrap) {
        sublineWrap.hidden = count === 0;
      }

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

    window.addEventListener('pvb:saved', renderItems);
    window.addEventListener('pvb:removed', renderItems);
    window.addEventListener('pvb:open-drawer', openDrawer);

    renderItems();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrawer);
  } else {
    initDrawer();
  }
})();
