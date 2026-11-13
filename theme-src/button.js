/**
 * PVB Button: Save to Board button for PDP.
 * Requires core.js to run first (via window.__pvb).
 */
(function () {
  'use strict';

  if (window.__pvbButton) return;
  window.__pvbButton = true;

  var pvb = window.__pvb;
  if (!pvb) return;

  function initSaveButton() {
    var wrapper = document.querySelector('[data-pvb-save-button]');
    if (!wrapper) return;

    var btn = wrapper.querySelector('.pvb-save-pill');
    var labelEl = wrapper.querySelector('.pvb-save-label');
    var helperEl = wrapper.querySelector('.pvb-save-helper');
    var viewChip = wrapper.querySelector('.pvb-view-chip');
    var viewCount = wrapper.querySelector('.pvb-view-count');
    if (!btn) return;

    var productId = wrapper.dataset.productId;
    var handle = wrapper.dataset.productHandle;
    var labelSave = wrapper.dataset.labelSave || 'Save to Board';
    var labelSaved = wrapper.dataset.labelSaved || 'Saved to Board';
    var helperSave = wrapper.dataset.helperSave || 'Not sure yet? Ask someone first.';
    var helperSaved = wrapper.dataset.helperSaved || 'Ask someone before you buy.';
    var dataMax = parseInt(wrapper.dataset.maxItems, 10);
    if (dataMax > 0) pvb.setMaxItems(dataMax);

    function getCurrentVariantId() {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return null;
      var input = form.querySelector('[name="id"]');
      return input ? input.value : null;
    }

    function updateState() {
      var variantId = getCurrentVariantId();
      if (!variantId) return;

      var saved = pvb.hasItem(variantId);
      var count = pvb.getCount();
      var full = count >= pvb.getMaxItems() && !saved;

      btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      btn.setAttribute('aria-label', saved ? labelSaved : labelSave);
      if (labelEl) labelEl.textContent = saved ? labelSaved : labelSave;
      if (helperEl) helperEl.textContent = saved ? helperSaved : helperSave;
      wrapper.dataset.full = full ? 'true' : 'false';

      if (viewChip) {
        viewChip.hidden = !saved;
        if (viewCount) viewCount.textContent = '(' + count + ')';
      }
    }

    btn.addEventListener('click', function () {
      var variantId = getCurrentVariantId();
      if (!variantId) return;

      if (pvb.hasItem(variantId)) {
        pvb.removeItem(variantId);
        pvb.publishEvent('button_unsave', { variantId: variantId, productId: productId });
      } else {
        var result = pvb.addItem({
          variantId: variantId,
          productId: productId,
          handle: handle
        });
        if (!result.ok && result.reason === 'full') {
          wrapper.dataset.full = 'true';
          return;
        }
        if (result.ok) {
          pvb.publishEvent('button_save', { variantId: variantId, productId: productId });
        }
      }
      updateState();
    });

    if (viewChip) {
      viewChip.addEventListener('click', function (e) {
        e.stopPropagation();
        pvb.dispatchEvent('pvb:open-drawer', {});
      });
    }

    var form = document.querySelector('form[action*="/cart/add"]');
    if (form && !form.dataset.pvbBound) {
      form.dataset.pvbBound = 'true';
      form.addEventListener('change', updateState);
    }
    window.addEventListener('popstate', updateState);
    window.addEventListener('pvb:removed', updateState);
    window.addEventListener('pvb:saved', updateState);

    updateState();

    // Button impression tracking: fire once when 50% visible
    if ('IntersectionObserver' in window) {
      var impressionFired = false;
      var observer = new IntersectionObserver(function (entries) {
        if (!impressionFired && entries[0].isIntersecting) {
          impressionFired = true;
          var variantId = getCurrentVariantId();
          pvb.publishEvent('button_impression', { variantId: variantId, productId: productId });
          observer.disconnect();
        }
      }, { threshold: 0.5 });
      observer.observe(wrapper);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSaveButton);
  } else {
    initSaveButton();
  }
})();
