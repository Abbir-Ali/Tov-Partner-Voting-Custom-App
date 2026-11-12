/**
 * PVB Share: share sheet UI and POST logic.
 * Lazy-loaded on first tap of "Get a Second Opinion".
 * Requires core.js (window.__pvb).
 */
(function () {
  'use strict';

  // Guard against double-load
  if (window.__pvbShare) return;
  window.__pvbShare = true;

  var pvb = window.__pvb;
  if (!pvb) return;

  // â”€â”€â”€ Storage Keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  var OWNER_KEY = 'pvb:owner:v1';
  var SHARES_KEY = 'pvb:shares:v1';

  // â”€â”€â”€ Module State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  var sheetOverlay = null;
  var formElement = null;
  var submitButton = null;
  var lastFocusedElement = null;
  var isSubmitting = false;
  var currentShareData = null;

  // Config loaded from drawer data attributes
  var config = {
    shopName: '',
    customerFirstName: '',
    customerEmail: '',
    isLoggedIn: false
  };

  // â”€â”€â”€ Config Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function loadConfig() {
    var d = document.querySelector('[data-pvb-drawer]');
    if (!d) return;
    config.shopName = d.dataset.shopName || '';
    config.customerFirstName = d.dataset.customerFirstName || '';
    config.customerEmail = d.dataset.customerEmail || '';
    config.isLoggedIn = d.dataset.loggedIn === 'true';
  }

  // â”€â”€â”€ Owner Name Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function getOwnerName() {
    try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; }
  }

  function saveOwnerName(name) {
    try { localStorage.setItem(OWNER_KEY, name); } catch (e) { /* storage unavailable */ }
  }

  // â”€â”€â”€ Share History Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function getShareHistory() {
    try {
      var raw = localStorage.getItem(SHARES_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* parse error */ }
    return [];
  }

  function saveShareToHistory(data) {
    try {
      var history = getShareHistory();
      history.unshift({
        partnerFirstName: data.partnerFirstName,
        resultsUrl: data.resultsUrl,
        count: data.count,
        sharedAt: Date.now()
      });
      if (history.length > 10) history.length = 10;
      localStorage.setItem(SHARES_KEY, JSON.stringify(history));
    } catch (e) { /* storage unavailable */ }
  }

  // â”€â”€â”€ DOM Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // â”€â”€â”€ Build Share Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function buildSheet() {
    if (sheetOverlay) return sheetOverlay;

    var drawer = document.querySelector('[data-pvb-drawer]');
    if (!drawer) return null;

    var overlay = el('div', 'pvb-share-overlay');
    overlay.dataset.open = 'false';

    var prefillOwnerName = config.customerFirstName || getOwnerName();
    var prefillEmail = config.customerEmail || '';
    var emailRequired = !config.isLoggedIn;

    var panel = el('div', 'pvb-share-panel', {
      role: 'dialog',
      'aria-modal': 'true',
      tabindex: '-1'
    });

    // Mobile handle
    panel.appendChild(el('div', 'pvb-share-handle'));

    // Header
    var header = el('div', 'pvb-share-header');
    var title = el('h2', 'pvb-share-title');
    title.textContent = 'Get a Second Opinion';
    header.appendChild(title);

    var closeButton = el('button', 'pvb-share-close', {
      type: 'button',
      'aria-label': 'Close'
    });
    closeButton.innerHTML = '&#10005;';
    header.appendChild(closeButton);
    panel.appendChild(header);

    // Body
    var body = el('div', 'pvb-share-body');
    var form = el('form', 'pvb-share-form', {
      id: 'pvb-share-form',
      novalidate: ''
    });

    // Form field builder
    function buildField(id, name, label, type, required, maxLength, value) {
      var fieldDiv = el('div', 'pvb-field');

      var labelEl = el('label', 'pvb-field-label', { for: id });
      if (required) labelEl.dataset.required = '';
      labelEl.textContent = label;
      fieldDiv.appendChild(labelEl);

      var input;
      if (type === 'textarea') {
        input = el('textarea', 'pvb-field-input pvb-field-textarea', {
          id: id,
          name: name,
          maxlength: maxLength,
          rows: '2'
        });
      } else {
        input = el('input', 'pvb-field-input', {
          type: type,
          id: id,
          name: name,
          maxlength: maxLength
        });
        if (required) input.required = true;
      }
      if (value) input.value = value;
      fieldDiv.appendChild(input);

      var errorSpan = el('span', 'pvb-field-error', { id: id + '-error' });
      fieldDiv.appendChild(errorSpan);

      return fieldDiv;
    }

    // Partner name (required)
    form.appendChild(buildField('pvb-partner-name', 'partnerFirstName', 'Their first name', 'text', true, '40'));

    // Note (optional, with counter)
    var noteField = buildField('pvb-note', 'note', 'Add a note', 'textarea', false, '280');
    var hintSpan = el('span', 'pvb-field-hint');
    hintSpan.innerHTML = '<span></span><span class="pvb-char-counter">0/280</span>';
    noteField.appendChild(hintSpan);
    form.appendChild(noteField);

    // Board name (optional)
    var boardNameField = buildField('pvb-board-name', 'boardName', 'Name this board', 'text', false, '60');
    boardNameField.querySelector('input').placeholder = 'Living Room Ideas';
    form.appendChild(boardNameField);

    // Owner name (required, prefilled)
    form.appendChild(buildField('pvb-owner-name', 'ownerFirstName', 'Your first name', 'text', true, '40', prefillOwnerName));

    // Owner email (required unless logged in, prefilled)
    form.appendChild(buildField('pvb-owner-email', 'ownerEmail', 'Your email', 'email', emailRequired, '254', prefillEmail));

    // General error
    form.appendChild(el('div', 'pvb-share-error', { id: 'pvb-general-error' }));

    // Ineligible items list
    form.appendChild(el('div', 'pvb-ineligible-list', { id: 'pvb-ineligible' }));

    body.appendChild(form);

    // Channels section (shown after successful API call)
    var channels = el('div', 'pvb-share-channels', { id: 'pvb-channels' });
    channels.dataset.visible = 'false';

    var channelsTitle = el('p', 'pvb-share-channels-title');
    channelsTitle.textContent = 'Share via';
    channels.appendChild(channelsTitle);

    var channelGrid = el('div', 'pvb-channel-grid');
    var channelData = [
      ['whatsapp', 'WhatsApp'],
      ['email', 'Email'],
      ['sms', 'SMS'],
      ['copy', 'Copy']
    ];
    var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    channelData.forEach(function (item) {
      if (item[0] === 'sms' && !isTouch) return;
      var btn = el('button', 'pvb-channel-btn', {
        type: 'button',
        'data-channel': item[0]
      });
      var labelAttr = item[0] === 'copy' ? ' id="pvb-copy-label"' : '';
      btn.innerHTML = '<span class="pvb-channel-label"' + labelAttr + '>' + item[1] + '</span>';
      channelGrid.appendChild(btn);
    });
    channels.appendChild(channelGrid);

    // Back button
    var backBtn = el('button', 'pvb-channel-back', { type: 'button' });
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', showSentScreen);
    channels.appendChild(backBtn);

    body.appendChild(channels);

    // Sent confirmation
    var sentSection = el('div', 'pvb-share-sent', { id: 'pvb-sent' });
    sentSection.dataset.visible = 'false';
    sentSection.innerHTML =
      '<div class="pvb-sent-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<h3 class="pvb-sent-title">Sent to <span id="pvb-sent-name"></span></h3>' +
      '<p class="pvb-sent-text" id="pvb-sent-body"></p>' +
      '<div class="pvb-sent-buttons">' +
        '<button type="button" class="pvb-sent-share-again">Share Again</button>' +
        '<button type="button" class="pvb-sent-done">Done</button>' +
      '</div>' +
      '<a href="#" class="pvb-sent-more" id="pvb-sent-more">More ways to share</a>';
    body.appendChild(sentSection);

    panel.appendChild(body);

    // Footer with submit button
    var footer = el('div', 'pvb-share-footer', { id: 'pvb-footer' });
    var submit = el('button', 'pvb-share-submit', {
      type: 'submit',
      form: 'pvb-share-form',
      id: 'pvb-submit'
    });
    submit.textContent = 'Send';
    footer.appendChild(submit);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    drawer.appendChild(overlay);

    // Store references
    sheetOverlay = overlay;
    formElement = form;
    submitButton = submit;

    // â”€â”€â”€ Event Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSheet();
    });

    closeButton.addEventListener('click', closeSheet);
    sentSection.querySelector('.pvb-sent-done').addEventListener('click', closeSheet);
    sentSection.querySelector('.pvb-sent-share-again').addEventListener('click', handleShareAgain);
    sentSection.querySelector('.pvb-sent-more').addEventListener('click', function(e) {
      e.preventDefault();
      showChannels();
    });

    // Note character counter
    var noteInput = form.querySelector('[name="note"]');
    var charCounter = body.querySelector('.pvb-char-counter');
    noteInput.addEventListener('input', function () {
      charCounter.textContent = noteInput.value.length + '/280';
    });

    // Update submit button text
    form.querySelector('[name="partnerFirstName"]').addEventListener('input', updateSubmitButtonText);

    // Form submission
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitShare();
    });

    // Channel buttons
    channelGrid.querySelectorAll('.pvb-channel-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleChannelClick(btn.dataset.channel);
      });
    });

    // Keyboard handling
    document.addEventListener('keydown', function (e) {
      if (sheetOverlay && sheetOverlay.dataset.open === 'true') {
        if (e.key === 'Escape') closeSheet();
        if (e.key === 'Tab') trapFocus(e);
      }
    });

    return sheetOverlay;
  }

  // â”€â”€â”€ Submit Button Text â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function updateSubmitButtonText() {
    if (!submitButton) return;
    var partnerName = formElement.querySelector('[name="partnerFirstName"]').value.trim();
    submitButton.textContent = partnerName ? 'Send to ' + partnerName : 'Send';
  }

  // â”€â”€â”€ Open Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function openSheet() {
    loadConfig();
    buildSheet();

    sheetOverlay.dataset.open = 'true';

    // Reset to form view
    formElement.style.display = '';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-general-error').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-ineligible').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-footer').style.display = '';

    clearFieldErrors();
    lastFocusedElement = document.activeElement;
    sheetOverlay.querySelector('.pvb-share-panel').focus();
    document.body.style.overflow = 'hidden';

    updateSubmitButtonText();
    pvb.dispatchEvent('pvb:share-open', { count: pvb.getCount() });
  }

  // â”€â”€â”€ Close Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function closeSheet() {
    if (!sheetOverlay) return;

    sheetOverlay.dataset.open = 'false';
    document.body.style.overflow = '';

    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  // â”€â”€â”€ Focus Trap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function trapFocus(e) {
    var panel = sheetOverlay.querySelector('.pvb-share-panel');
    var focusable = panel.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
    );
    var firstEl = focusable[0];
    var lastEl = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  // â”€â”€â”€ Field Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function clearFieldErrors() {
    if (!formElement) return;

    formElement.querySelectorAll('.pvb-field-error').forEach(function (el) {
      el.textContent = '';
    });
    formElement.querySelectorAll('.pvb-field-input').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function showFieldError(fieldName, message) {
    var input = formElement.querySelector('[name="' + fieldName + '"]');
    if (!input) return;

    input.setAttribute('aria-invalid', 'true');
    var errorEl = document.getElementById('pvb-' + fieldName.replace(/([A-Z])/g, '-$1').toLowerCase() + '-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  function validateForm() {
    clearFieldErrors();
    var isValid = true;

    var partnerName = formElement.querySelector('[name="partnerFirstName"]').value.trim();
    if (!partnerName) {
      showFieldError('partnerFirstName', 'Enter their name');
      isValid = false;
    }

    var ownerName = formElement.querySelector('[name="ownerFirstName"]').value.trim();
    if (!ownerName) {
      showFieldError('ownerFirstName', 'Enter your name');
      isValid = false;
    }

    var emailInput = formElement.querySelector('[name="ownerEmail"]');
    var emailValue = emailInput.value.trim();
    if (emailInput.required && !emailValue) {
      showFieldError('ownerEmail', 'Enter your email');
      isValid = false;
    } else if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      showFieldError('ownerEmail', 'Enter a valid email');
      isValid = false;
    }

    return isValid;
  }

  // â”€â”€â”€ Submit Share â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function submitShare() {
    if (isSubmitting || !validateForm()) return;

    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.dataset.loading = 'true';
    submitButton.textContent = 'Sending...';

    sheetOverlay.querySelector('#pvb-general-error').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-ineligible').dataset.visible = 'false';

    var items = pvb.getItems();
    var payload = {
      partnerFirstName: formElement.querySelector('[name="partnerFirstName"]').value.trim(),
      ownerFirstName: formElement.querySelector('[name="ownerFirstName"]').value.trim(),
      ownerEmail: formElement.querySelector('[name="ownerEmail"]').value.trim() || null,
      name: formElement.querySelector('[name="boardName"]').value.trim() || null,
      note: formElement.querySelector('[name="note"]').value.trim() || null,
      items: items.map(function (item) {
        return { variantId: item.variantId };
      })
    };

    var apiUrl = ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/') +
      'apps/board/api/boards';

    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { status: response.status, data: data };
        });
      })
      .then(function (result) {
        isSubmitting = false;
        submitButton.disabled = false;
        submitButton.dataset.loading = '';
        updateSubmitButtonText();

        if (result.status === 201) {
          handleSuccess(result.data, payload);
        } else {
          handleError(result.data);
        }
      })
      .catch(function () {
        isSubmitting = false;
        submitButton.disabled = false;
        submitButton.dataset.loading = '';
        updateSubmitButtonText();
        showGeneralError('Something went wrong.');
      });
  }

  // â”€â”€â”€ Success Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleSuccess(responseData, payload) {
    // Save owner name (never email)
    saveOwnerName(payload.ownerFirstName);

    // Save to share history
    saveShareToHistory({
      partnerFirstName: payload.partnerFirstName,
      resultsUrl: responseData.resultsUrl,
      count: pvb.getCount()
    });

    // Store data for share message
    currentShareData = {
      shareUrl: responseData.shareUrl,
      ownerFirstName: payload.ownerFirstName,
      partnerFirstName: payload.partnerFirstName,
      note: payload.note,
      itemCount: pvb.getCount()
    };

    pvb.dispatchEvent('pvb:shared', { count: pvb.getCount() });

    // Try native share on mobile, fall back to channels
    if (navigator.share) {
      navigator.share({
        title: config.shopName,
        text: buildShareMessage(),
        url: responseData.shareUrl
      })
        .then(showSentScreen)
        .catch(showChannels);
    } else {
      showChannels();
    }
  }

  // â”€â”€â”€ Error Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleError(data) {
    var err = data.error || data;

    // Field validation errors
    if (err.code === 'invalid' && err.fields) {
      clearFieldErrors();
      for (var field in err.fields) {
        showFieldError(field, err.fields[field]);
      }
      return;
    }

    // Ineligible items
    if (err.code === 'ineligible' && err.items) {
      showIneligibleItems(err.items);
      return;
    }

    // Rate limit - use server message
    if (err.code === 'limit') {
      showGeneralError(err.message || 'Too many shares.');
      return;
    }

    // Feature disabled
    if (err.code === 'disabled') {
      showGeneralError('Sharing is turned off right now.');
      return;
    }

    // Anything else
    showGeneralError('Something went wrong. Try again in a moment.');
    return;
  }

  function getReasonText(reason) {
    if (reason === 'excluded_tag' || reason === 'gift_card') {
      return 'Not available for sharing';
    }
    if (reason === 'not_available') {
      return 'Sold out';
    }
    if (reason === 'product_not_active' || reason === 'not_found') {
      return 'No longer available';
    }
    return 'Not available';
  }

  function showGeneralError(message) {
    var errorEl = sheetOverlay.querySelector('#pvb-general-error');
    errorEl.textContent = message;
    errorEl.dataset.visible = 'true';
  }

  function showIneligibleItems(items) {
    var container = sheetOverlay.querySelector('#pvb-ineligible');
    container.innerHTML = '<p>Some pieces can\'t be shared right now:</p>';

    items.forEach(function (item) {
      // Convert API GID to numeric ID for comparison
      var numericId = pvb.toNumericId(item.variantId);

      // Get title from board items cache, then look up product
      var boardItems = pvb.getItems();
      var title = 'A saved piece';
      var boardItem = null;
      for (var i = 0; i < boardItems.length; i++) {
        if (pvb.toNumericId(boardItems[i].variantId) === numericId) {
          boardItem = boardItems[i];
          break;
        }
      }

      // Try to get product title from handle
      if (boardItem && boardItem.handle) {
        pvb.fetchProduct(boardItem.handle).then(function (product) {
          if (product && product.title) {
            var titleEl = itemDiv.querySelector('.pvb-ineligible-title');
            if (titleEl) titleEl.textContent = product.title;
          }
        });
      }

      var itemDiv = el('div', 'pvb-ineligible-item');
      itemDiv.dataset.variantId = numericId;
      var reason = getReasonText(item.reason);
      itemDiv.innerHTML =
        '<span class="pvb-ineligible-title">' + pvb.escapeHtml(title) + '</span>' +
        '<span class="pvb-ineligible-reason">' + pvb.escapeHtml(reason) + '</span>' +
        '<button type="button" class="pvb-ineligible-remove">Remove</button>';

      itemDiv.querySelector('button').onclick = function () {
        pvb.removeItem(numericId);
        itemDiv.remove();
        if (!container.querySelector('.pvb-ineligible-item')) {
          container.dataset.visible = 'false';
        }
      };

      container.appendChild(itemDiv);
    });

    container.dataset.visible = 'true';
  }

  // â”€â”€â”€ Share Message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function buildShareMessage() {
    var message = currentShareData.ownerFirstName +
      ' wants your vote on ' +
      currentShareData.itemCount +
      ' pieces from ' +
      config.shopName + '.';

    if (currentShareData.note) {
      message += ' "' + currentShareData.note + '"';
    }

    return message;
  }

  // â”€â”€â”€ Channel Sharing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function showChannels() {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'true';
    document.getElementById('pvb-copy-label').textContent = 'Copy';
  }

  function handleChannelClick(channel) {
    var message = buildShareMessage();
    var url = currentShareData.shareUrl;
    var fullText = message + ' ' + url;

    if (channel === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(fullText), '_blank');
    } else if (channel === 'email') {
      var subject = currentShareData.ownerFirstName + ' wants your vote';
      window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(fullText);
    } else if (channel === 'sms') {
      window.location.href = 'sms:?&body=' + encodeURIComponent(fullText);
    } else if (channel === 'copy') {
      copyToClipboard(url);
      return; // Don't show sent screen for copy
    }

    showSentScreen();
  }

  function copyToClipboard(text) {
    var label = document.getElementById('pvb-copy-label');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { label.textContent = 'Copied'; }).catch(function () { copyFallback(text, label); });
    } else {
      copyFallback(text, label);
    }
  }

  function copyFallback(text, label) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); label.textContent = 'Copied'; } catch (e) { label.textContent = 'Failed'; }
    document.body.removeChild(ta);
  }

  // â”€â”€â”€ Share Again Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleShareAgain() {
    if (!currentShareData) return;

    // Try native share; show "More ways to share" link on native platforms
    if (navigator.share) {
      navigator.share({
        title: config.shopName,
        text: buildShareMessage(),
        url: currentShareData.shareUrl
      }).catch(function() {
        // User cancelled or failed, stay on sent screen
      });
    } else {
      // Desktop: go straight to channels
      showChannels();
    }
  }

  // â”€â”€â”€ Sent Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function showSentScreen() {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    var sentSection = sheetOverlay.querySelector('#pvb-sent');
    sentSection.dataset.visible = 'true';
    document.getElementById('pvb-sent-name').textContent = currentShareData.partnerFirstName;
    document.getElementById('pvb-sent-body').textContent =
      "We'll let you know the moment " + currentShareData.partnerFirstName +
      " votes. Your board stays saved here.";

    // Show "More ways to share" link only when native share is available
    var moreLink = document.getElementById('pvb-sent-more');
    if (moreLink) {
      moreLink.style.display = navigator.share ? '' : 'none';
    }
  }

  // â”€â”€â”€ Initialize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.addEventListener('pvb:share-request', openSheet);
})();
