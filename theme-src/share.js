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

  // ─── Storage Keys ─────────────────────────────────────────────────────────
  var OWNER_KEY = 'pvb:owner:v1';
  var SHARES_KEY = 'pvb:shares:v1';

  // ─── Module State ─────────────────────────────────────────────────────────
  var sheetOverlay = null;
  var formElement = null;
  var submitButton = null;
  var lastFocusedElement = null;
  var isSubmitting = false;
  var currentShareData = null;
  var sheetIsOpen = false;

  // Config loaded from drawer data attributes
  var config = {
    shopName: '',
    customerFirstName: '',
    customerEmail: '',
    isLoggedIn: false
  };

  // ─── Config Loading ─────────────────────────────────────────────────────────
  function loadConfig() {
    var d = document.querySelector('[data-pvb-drawer]');
    if (!d) return;
    config.shopName = d.dataset.shopName || '';
    config.customerFirstName = d.dataset.customerFirstName || '';
    config.customerEmail = d.dataset.customerEmail || '';
    config.isLoggedIn = d.dataset.loggedIn === 'true';
  }

  // ─── Owner Name Storage ─────────────────────────────────────────────────────
  function getOwnerName() {
    try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; }
  }

  function saveOwnerName(name) {
    try { localStorage.setItem(OWNER_KEY, name); } catch (e) { /* storage unavailable */ }
  }

  // ─── Share History Storage ──────────────────────────────────────────────────
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
        voterNames: data.voterNames || [data.partnerFirstName],
        hasGroupLink: data.hasGroupLink || false,
        resultsUrl: data.resultsUrl,
        count: data.count,
        sharedAt: Date.now()
      });
      if (history.length > 10) history.length = 10;
      localStorage.setItem(SHARES_KEY, JSON.stringify(history));
    } catch (e) { /* storage unavailable */ }
  }

  // ─── DOM Helpers ──────────────────────────────────────────────────────────
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // On mobile, scroll input into view after keyboard opens (300ms delay)
  function handleInputFocus(e) {
    var input = e.target;
    if (window.innerWidth >= 750) return;
    setTimeout(function () {
      if (document.activeElement === input) {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  }

  // ─── Build Share Sheet ────────────────────────────────────────────────────
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

    // ─── Names List ─────────────────────────────────────────────────────────
    var namesSection = el('div', 'pvb-field pvb-names-section');
    var namesLabel = el('label', 'pvb-field-label');
    namesLabel.dataset.required = '';
    namesLabel.textContent = 'Who should vote?';
    namesSection.appendChild(namesLabel);

    var namesList = el('div', 'pvb-names-list', { id: 'pvb-names-list' });
    namesSection.appendChild(namesList);

    var namesError = el('span', 'pvb-field-error', { id: 'pvb-voter-names-error' });
    namesSection.appendChild(namesError);

    var addBtn = el('button', 'pvb-names-add', { type: 'button', id: 'pvb-add-name' });
    addBtn.textContent = 'Add Another Person';
    namesSection.appendChild(addBtn);

    form.appendChild(namesSection);

    // Note (optional, with counter)
    var noteField = el('div', 'pvb-field');
    var noteLabelEl = el('label', 'pvb-field-label', { for: 'pvb-note' });
    noteLabelEl.textContent = 'Add a note';
    noteField.appendChild(noteLabelEl);
    var noteInput = el('textarea', 'pvb-field-input pvb-field-textarea', {
      id: 'pvb-note',
      name: 'note',
      maxlength: '280',
      rows: '2'
    });
    noteField.appendChild(noteInput);
    var hintSpan = el('span', 'pvb-field-hint');
    hintSpan.innerHTML = '<span></span><span class="pvb-char-counter">0/280</span>';
    noteField.appendChild(hintSpan);
    form.appendChild(noteField);

    // Board name (optional)
    var boardNameField = el('div', 'pvb-field');
    var boardNameLabel = el('label', 'pvb-field-label', { for: 'pvb-board-name' });
    boardNameLabel.textContent = 'Name this board';
    boardNameField.appendChild(boardNameLabel);
    var boardNameInput = el('input', 'pvb-field-input', {
      type: 'text',
      id: 'pvb-board-name',
      name: 'boardName',
      maxlength: '60',
      placeholder: 'Living Room Ideas'
    });
    boardNameField.appendChild(boardNameInput);
    form.appendChild(boardNameField);

    // Group link toggle
    var groupField = el('div', 'pvb-field pvb-field-toggle', { id: 'pvb-group-field' });
    var groupLabel = el('label', 'pvb-toggle-row');
    groupLabel.innerHTML =
      '<span class="pvb-toggle-text">Also make a group link</span>' +
      '<input type="checkbox" name="groupVoting" id="pvb-group-voting" class="pvb-toggle-input">' +
      '<span class="pvb-toggle-switch"></span>';
    groupField.appendChild(groupLabel);
    var groupHint = el('span', 'pvb-toggle-hint', { id: 'pvb-group-hint' });
    groupHint.textContent = 'Anyone with it can vote once.';
    groupField.appendChild(groupHint);
    form.appendChild(groupField);

    // Hide prices toggle
    var hidePricesField = el('div', 'pvb-field pvb-field-toggle');
    var hidePricesLabel = el('label', 'pvb-toggle-row');
    hidePricesLabel.innerHTML =
      '<span class="pvb-toggle-text">Hide prices from voters</span>' +
      '<input type="checkbox" name="hidePrices" id="pvb-hide-prices" class="pvb-toggle-input">' +
      '<span class="pvb-toggle-switch"></span>';
    hidePricesField.appendChild(hidePricesLabel);
    var hidePricesHint = el('span', 'pvb-toggle-hint');
    hidePricesHint.textContent = 'They see the pieces, not the prices.';
    hidePricesField.appendChild(hidePricesHint);
    form.appendChild(hidePricesField);

    // Owner name (required, prefilled)
    var ownerField = el('div', 'pvb-field');
    var ownerLabel = el('label', 'pvb-field-label', { for: 'pvb-owner-name' });
    ownerLabel.dataset.required = '';
    ownerLabel.textContent = 'Your first name';
    ownerField.appendChild(ownerLabel);
    var ownerInput = el('input', 'pvb-field-input', {
      type: 'text',
      id: 'pvb-owner-name',
      name: 'ownerFirstName',
      maxlength: '40',
      required: ''
    });
    ownerInput.value = prefillOwnerName;
    ownerField.appendChild(ownerInput);
    ownerField.appendChild(el('span', 'pvb-field-error', { id: 'pvb-owner-first-name-error' }));
    form.appendChild(ownerField);

    // Owner email (required unless logged in, prefilled)
    var emailField = el('div', 'pvb-field');
    var emailLabel = el('label', 'pvb-field-label', { for: 'pvb-owner-email' });
    if (emailRequired) emailLabel.dataset.required = '';
    emailLabel.textContent = 'Your email';
    emailField.appendChild(emailLabel);
    var emailInput = el('input', 'pvb-field-input', {
      type: 'email',
      id: 'pvb-owner-email',
      name: 'ownerEmail',
      maxlength: '254'
    });
    if (emailRequired) emailInput.required = true;
    emailInput.value = prefillEmail;
    emailField.appendChild(emailInput);
    emailField.appendChild(el('span', 'pvb-field-error', { id: 'pvb-owner-email-error' }));
    form.appendChild(emailField);

    // General error
    form.appendChild(el('div', 'pvb-share-error', { id: 'pvb-general-error' }));

    // Ineligible items list
    form.appendChild(el('div', 'pvb-ineligible-list', { id: 'pvb-ineligible' }));

    body.appendChild(form);

    // Channels section (shown after successful API call)
    var channels = el('div', 'pvb-share-channels', { id: 'pvb-channels' });
    channels.dataset.visible = 'false';
    body.appendChild(channels);

    // Links screen (shown after board creation)
    var linksScreen = el('div', 'pvb-links-screen', { id: 'pvb-links-screen' });
    linksScreen.dataset.visible = 'false';
    body.appendChild(linksScreen);

    // Sent confirmation (for single-link flow)
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
    submit.textContent = 'Create Link';
    footer.appendChild(submit);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    drawer.appendChild(overlay);

    // Store references
    sheetOverlay = overlay;
    formElement = form;
    submitButton = submit;

    // ─── Event Listeners ─────────────────────────────────────────────────────
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSheet();
    });

    closeButton.addEventListener('click', closeSheet);
    sentSection.querySelector('.pvb-sent-done').addEventListener('click', closeSheet);
    sentSection.querySelector('.pvb-sent-share-again').addEventListener('click', handleShareAgain);
    sentSection.querySelector('.pvb-sent-more').addEventListener('click', function(e) {
      e.preventDefault();
      showChannelsForLink(currentShareData.links[0]);
    });

    // Note character counter
    noteInput.addEventListener('input', function () {
      body.querySelector('.pvb-char-counter').textContent = noteInput.value.length + '/280';
    });

    // Add first name field
    addNameField();

    // Add name button
    addBtn.addEventListener('click', function() {
      addNameField();
      updateGroupToggleState();
      updateSubmitButtonText();
    });

    // Group toggle: update button text
    var groupToggle = document.getElementById('pvb-group-voting');
    if (groupToggle) {
      groupToggle.addEventListener('change', updateSubmitButtonText);
    }

    // Mobile: scroll input into view when focused
    form.querySelectorAll('input, textarea').forEach(function (input) {
      input.addEventListener('focus', handleInputFocus);
    });

    // Form submission
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitShare();
    });

    // Keyboard handling
    document.addEventListener('keydown', function (e) {
      if (sheetOverlay && sheetOverlay.dataset.open === 'true') {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeSheet();
        }
        if (e.key === 'Tab') trapFocus(e);
      }
    });

    return sheetOverlay;
  }

  // ─── Names List ─────────────────────────────────────────────────────────────
  function addNameField() {
    var list = document.getElementById('pvb-names-list');
    if (!list) return;

    var count = list.querySelectorAll('.pvb-name-row').length;
    if (count >= 5) return;

    var row = el('div', 'pvb-name-row');
    var input = el('input', 'pvb-field-input pvb-name-input', {
      type: 'text',
      name: 'voterName',
      placeholder: count === 0 ? 'Their first name' : 'First name',
      maxlength: '30'
    });
    row.appendChild(input);

    // Remove button (not on first field)
    if (count > 0) {
      var removeBtn = el('button', 'pvb-name-remove', { type: 'button', 'aria-label': 'Remove' });
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', function() {
        row.remove();
        updateGroupToggleState();
        updateSubmitButtonText();
      });
      row.appendChild(removeBtn);
    }

    list.appendChild(row);

    // Update add button visibility
    updateAddButtonState();

    // Focus new input
    input.focus();
    input.addEventListener('input', function() {
      updateSubmitButtonText();
      // Clear duplicate name error when field changes
      var errorEl = document.getElementById('pvb-voter-names-error');
      if (errorEl && errorEl.textContent.indexOf('different name') !== -1) {
        errorEl.textContent = '';
        errorEl.dataset.visible = 'false';
      }
    });
  }

  function updateAddButtonState() {
    var list = document.getElementById('pvb-names-list');
    var addBtn = document.getElementById('pvb-add-name');
    if (!list || !addBtn) return;

    var count = list.querySelectorAll('.pvb-name-row').length;
    addBtn.style.display = count >= 5 ? 'none' : '';
  }

  function updateGroupToggleState() {
    var list = document.getElementById('pvb-names-list');
    var groupField = document.getElementById('pvb-group-field');
    var groupInput = document.getElementById('pvb-group-voting');
    var groupHint = document.getElementById('pvb-group-hint');
    if (!list || !groupField || !groupInput) return;

    var count = list.querySelectorAll('.pvb-name-row').length;
    if (count >= 5) {
      groupInput.checked = false;
      groupInput.disabled = true;
      groupField.classList.add('pvb-toggle-disabled');
      if (groupHint) groupHint.textContent = 'Remove a name to add a group link.';
    } else {
      groupInput.disabled = false;
      groupField.classList.remove('pvb-toggle-disabled');
      if (groupHint) groupHint.textContent = 'Anyone with it can vote once.';
    }
  }

  function getVoterNames() {
    var list = document.getElementById('pvb-names-list');
    if (!list) return [];
    var names = [];
    list.querySelectorAll('.pvb-name-input').forEach(function(input) {
      var name = input.value.trim();
      if (name) names.push(name);
    });
    return names;
  }

  // ─── Submit Button Text ─────────────────────────────────────────────────────
  function updateSubmitButtonText() {
    if (!submitButton) return;
    var names = getVoterNames();
    var groupOn = document.getElementById('pvb-group-voting');
    var linkCount = names.length + (groupOn && groupOn.checked ? 1 : 0);
    if (linkCount === 0) linkCount = 1;
    submitButton.textContent = linkCount === 1 ? 'Create Link' : 'Create ' + linkCount + ' Links';
  }

  // ─── Open Sheet ─────────────────────────────────────────────────────────────
  function openSheet() {
    if (sheetIsOpen) return;
    loadConfig();
    buildSheet();

    sheetOverlay.dataset.open = 'true';
    sheetIsOpen = true;

    // Reset to form view
    formElement.style.display = '';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-links-screen').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-general-error').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-ineligible').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-footer').style.display = '';

    clearFieldErrors();
    lastFocusedElement = document.activeElement;
    sheetOverlay.querySelector('.pvb-share-panel').focus();
    pvb.lockScroll();

    updateSubmitButtonText();
    pvb.dispatchEvent('pvb:share-open', { count: pvb.getCount() });
    pvb.publishEvent('share_open', { count: pvb.getCount() });
  }

  // ─── Close Sheet ────────────────────────────────────────────────────────────
  function closeSheet() {
    if (!sheetOverlay || !sheetIsOpen) return;

    sheetOverlay.dataset.open = 'false';
    sheetIsOpen = false;
    pvb.unlockScroll();

    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  // ─── Focus Trap ─────────────────────────────────────────────────────────────
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

  // ─── Field Validation ───────────────────────────────────────────────────────
  function clearFieldErrors() {
    if (!formElement) return;

    formElement.querySelectorAll('.pvb-field-error').forEach(function (el) {
      el.textContent = '';
      el.dataset.visible = 'false';
    });
    formElement.querySelectorAll('.pvb-field-input').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function showFieldError(fieldName, message) {
    var errorEl = document.getElementById('pvb-' + fieldName.replace(/([A-Z])/g, '-$1').toLowerCase() + '-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.dataset.visible = 'true';
    }
    // Mark input invalid
    var input = formElement.querySelector('[name="' + fieldName + '"]');
    if (input) input.setAttribute('aria-invalid', 'true');
  }

  // Scroll to first invalid field and focus it
  function scrollToFirstError() {
    var firstError = formElement.querySelector('[aria-invalid="true"]');
    if (firstError) {
      firstError.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function() { firstError.focus(); }, 300);
    }
  }

  function validateForm() {
    clearFieldErrors();
    var isValid = true;

    // Voter names
    var names = getVoterNames();
    if (names.length === 0) {
      showFieldError('voterNames', 'Add at least one person\'s name.');
      isValid = false;
    } else {
      // Check for duplicates
      var seen = {};
      for (var i = 0; i < names.length; i++) {
        var lower = names[i].toLowerCase();
        if (seen[lower]) {
          showFieldError('voterNames', 'Use a different name for each person.');
          isValid = false;
          break;
        }
        seen[lower] = true;
      }
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

  // ─── Submit Share ───────────────────────────────────────────────────────────
  function submitShare() {
    if (isSubmitting) return;
    if (!validateForm()) {
      scrollToFirstError();
      return;
    }

    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.dataset.loading = 'true';
    submitButton.textContent = 'Creating...';

    sheetOverlay.querySelector('#pvb-general-error').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-ineligible').dataset.visible = 'false';

    var items = pvb.getItems();
    var voterNames = getVoterNames();
    var groupVoting = formElement.querySelector('[name="groupVoting"]').checked;

    var payload = {
      voterNames: voterNames,
      ownerFirstName: formElement.querySelector('[name="ownerFirstName"]').value.trim(),
      ownerEmail: formElement.querySelector('[name="ownerEmail"]').value.trim() || null,
      name: formElement.querySelector('[name="boardName"]').value.trim() || null,
      note: formElement.querySelector('[name="note"]').value.trim() || null,
      groupVoting: groupVoting,
      hidePrices: formElement.querySelector('[name="hidePrices"]').checked,
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

  // ─── Success Handler ────────────────────────────────────────────────────────
  function handleSuccess(responseData, payload) {
    // Save owner name (never email)
    saveOwnerName(payload.ownerFirstName);

    // Save to share history
    saveShareToHistory({
      voterNames: payload.voterNames,
      hasGroupLink: payload.groupVoting,
      resultsUrl: responseData.resultsUrl,
      count: pvb.getCount()
    });

    // Store data for share messages
    currentShareData = {
      boardId: responseData.boardId,
      links: responseData.links || [],
      shareUrl: responseData.shareUrl,
      ownerFirstName: payload.ownerFirstName,
      note: payload.note,
      itemCount: pvb.getCount()
    };

    pvb.dispatchEvent('pvb:shared', { count: pvb.getCount() });

    // Show links screen or single-link flow
    if (currentShareData.links.length === 1 && currentShareData.links[0].kind === 'personal') {
      // Single personal link: use existing channel flow
      showChannelsForLink(currentShareData.links[0]);
    } else {
      // Multiple links or group link: show links screen
      showLinksScreen();
    }
  }

  // ─── Error Handler ──────────────────────────────────────────────────────────
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
      var numericId = pvb.toNumericId(item.variantId);
      var boardItems = pvb.getItems();
      var title = 'A saved piece';
      var boardItem = null;
      for (var i = 0; i < boardItems.length; i++) {
        if (pvb.toNumericId(boardItems[i].variantId) === numericId) {
          boardItem = boardItems[i];
          break;
        }
      }

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

  // ─── Share Message ──────────────────────────────────────────────────────────
  function buildShareMessage(link) {
    var count = currentShareData.itemCount;
    var pieces = count === 1 ? '1 piece' : count + ' pieces';
    var shopName = config.shopName.trim();
    var message;

    if (link && link.kind === 'personal' && link.name) {
      // Personal link: "[Owner] wants your take on X pieces, [Name]."
      message = currentShareData.ownerFirstName +
        ' wants your take on ' + pieces + ' from ' + shopName + ', ' + link.name + '.';
    } else if (link && link.kind === 'group') {
      // Group link: generic
      message = currentShareData.ownerFirstName +
        ' wants your vote on ' + pieces + ' from ' + shopName + '.';
    } else {
      // Fallback
      message = currentShareData.ownerFirstName +
        ' wants your vote on ' + pieces + ' from ' + shopName + '.';
    }

    if (currentShareData.note) {
      message += ' "' + currentShareData.note + '"';
    }

    return message;
  }

  // ─── Links Screen ───────────────────────────────────────────────────────────
  function showLinksScreen() {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';

    var linksScreen = sheetOverlay.querySelector('#pvb-links-screen');
    linksScreen.innerHTML = '';

    var title = el('h3', 'pvb-links-title');
    title.textContent = 'Send the links';
    linksScreen.appendChild(title);

    var linksList = el('div', 'pvb-links-list');

    currentShareData.links.forEach(function(link) {
      var row = el('div', 'pvb-link-row');

      var header = el('div', 'pvb-link-header');
      var label = el('span', 'pvb-link-label');
      if (link.kind === 'personal') {
        label.textContent = link.name;
      } else {
        label.textContent = 'Group link';
        var hint = el('span', 'pvb-link-hint');
        hint.textContent = 'Anyone can vote once';
        header.appendChild(hint);
      }
      header.insertBefore(label, header.firstChild);
      row.appendChild(header);

      // Channel buttons
      var channels = el('div', 'pvb-link-channels');
      var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

      // WhatsApp
      var waBtn = el('button', 'pvb-link-btn', { type: 'button', 'data-channel': 'whatsapp' });
      waBtn.textContent = 'WhatsApp';
      waBtn.addEventListener('click', function() { shareViaChannel('whatsapp', link); });
      channels.appendChild(waBtn);

      // SMS (touch only)
      if (isTouch) {
        var smsBtn = el('button', 'pvb-link-btn', { type: 'button', 'data-channel': 'sms' });
        smsBtn.textContent = 'SMS';
        smsBtn.addEventListener('click', function() { shareViaChannel('sms', link); });
        channels.appendChild(smsBtn);
      }

      // Email
      var emailBtn = el('button', 'pvb-link-btn', { type: 'button', 'data-channel': 'email' });
      emailBtn.textContent = 'Email';
      emailBtn.addEventListener('click', function() { shareViaChannel('email', link); });
      channels.appendChild(emailBtn);

      // Copy
      var copyBtn = el('button', 'pvb-link-btn pvb-link-copy-btn', { type: 'button', 'data-channel': 'copy' });
      copyBtn.textContent = 'Copy Link';
      copyBtn.addEventListener('click', function() {
        copyLinkToClipboard(link.url, copyBtn);
        sendChannelEvent('copy', currentShareData.boardId);
      });
      channels.appendChild(copyBtn);

      // More options
      if (navigator.share) {
        var moreBtn = el('button', 'pvb-link-btn pvb-link-more', { type: 'button' });
        moreBtn.textContent = 'More';
        moreBtn.addEventListener('click', function() { shareViaNative(link); });
        channels.appendChild(moreBtn);
      }

      row.appendChild(channels);
      linksList.appendChild(row);
    });

    linksScreen.appendChild(linksList);

    // Done button
    var doneBtn = el('button', 'pvb-links-done', { type: 'button' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', closeSheet);
    linksScreen.appendChild(doneBtn);

    linksScreen.dataset.visible = 'true';
  }

  function shareViaChannel(channel, link) {
    var message = buildShareMessage(link);
    var url = link.url;
    var fullText = message + ' ' + url;

    sendChannelEvent(channel, currentShareData.boardId);

    if (channel === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(fullText), '_blank');
    } else if (channel === 'email') {
      var subject = currentShareData.ownerFirstName + ' wants your vote';
      var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!isTouch) {
        // Desktop: show email options
        showEmailOptions(subject, fullText);
        return;
      }
      window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(fullText);
    } else if (channel === 'sms') {
      window.location.href = 'sms:?&body=' + encodeURIComponent(fullText);
    }
  }

  function shareViaNative(link) {
    if (!navigator.share) return;
    var message = buildShareMessage(link);
    navigator.share({
      title: config.shopName,
      text: message,
      url: link.url
    })
      .then(function() {
        sendChannelEvent('native', currentShareData.boardId);
      })
      .catch(function() {});
  }

  function copyLinkToClipboard(url, btn) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = 'Copy Link'; }, 2000);
      }).catch(function() {
        copyFallback(url, btn);
      });
    } else {
      copyFallback(url, btn);
    }
  }

  function showEmailOptions(subject, body) {
    // Create a modal-style panel for email options
    var panel = sheetOverlay.querySelector('#pvb-email-modal');
    if (!panel) {
      panel = el('div', 'pvb-email-modal', { id: 'pvb-email-modal' });
      panel.innerHTML =
        '<div class="pvb-email-modal-content">' +
          '<p class="pvb-email-title">Open your email</p>' +
          '<div class="pvb-email-options">' +
            '<button type="button" class="pvb-email-option" data-provider="gmail">Gmail</button>' +
            '<button type="button" class="pvb-email-option" data-provider="outlook">Outlook</button>' +
            '<button type="button" class="pvb-email-option" data-provider="copy">Copy Message</button>' +
          '</div>' +
          '<button type="button" class="pvb-email-back">Back</button>' +
        '</div>';
      sheetOverlay.querySelector('.pvb-share-body').appendChild(panel);
    }

    panel.querySelector('.pvb-email-options').onclick = function(e) {
      var provider = e.target.dataset.provider;
      if (!provider) return;
      var subjectEnc = encodeURIComponent(subject);
      var bodyEnc = encodeURIComponent(body);
      if (provider === 'gmail') {
        window.open('https://mail.google.com/mail/?view=cm&fs=1&su=' + subjectEnc + '&body=' + bodyEnc, '_blank');
        panel.dataset.visible = 'false';
      } else if (provider === 'outlook') {
        window.open('https://outlook.live.com/mail/0/deeplink/compose?subject=' + subjectEnc + '&body=' + bodyEnc, '_blank');
        panel.dataset.visible = 'false';
      } else if (provider === 'copy') {
        var fullMsg = subject + '\n\n' + body;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(fullMsg).then(function() {
            e.target.textContent = 'Copied';
          });
        }
      }
    };

    panel.querySelector('.pvb-email-back').onclick = function() {
      panel.dataset.visible = 'false';
    };

    panel.dataset.visible = 'true';
  }

  // ─── Channel Sharing (single-link flow) ─────────────────────────────────────
  function showChannelsForLink(link) {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    sheetOverlay.querySelector('#pvb-links-screen').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';

    var channels = sheetOverlay.querySelector('#pvb-channels');
    channels.innerHTML = '';

    var channelsTitle = el('p', 'pvb-share-channels-title');
    channelsTitle.textContent = 'Share via';
    channels.appendChild(channelsTitle);

    var channelGrid = el('div', 'pvb-channel-grid');
    var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    var channelData = [
      ['whatsapp', 'WhatsApp'],
      ['sms', 'SMS'],
      ['email', 'Email'],
      ['copy', 'Copy Link']
    ];

    channelData.forEach(function(item) {
      if (item[0] === 'sms' && !isTouch) return;
      var btn = el('button', 'pvb-channel-btn', { type: 'button', 'data-channel': item[0] });
      var labelId = item[0] === 'copy' ? ' id="pvb-copy-label"' : '';
      btn.innerHTML = '<span class="pvb-channel-label"' + labelId + '>' + item[1] + '</span>';
      btn.addEventListener('click', function() {
        handleChannelClick(item[0], link);
      });
      channelGrid.appendChild(btn);
    });

    channels.appendChild(channelGrid);

    if (navigator.share) {
      var moreBtn = el('button', 'pvb-channel-more', { type: 'button' });
      moreBtn.textContent = 'More Options';
      moreBtn.addEventListener('click', function() {
        shareViaNative(link);
      });
      channels.appendChild(moreBtn);
    }

    var doneBtn = el('button', 'pvb-channel-back', { type: 'button' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', function() {
      showSentScreen(link);
    });
    channels.appendChild(doneBtn);

    channels.dataset.visible = 'true';
  }

  function handleChannelClick(channel, link) {
    var message = buildShareMessage(link);
    var url = link.url;
    var fullText = message + ' ' + url;

    sendChannelEvent(channel, currentShareData.boardId);

    if (channel === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(fullText), '_blank');
      showSentScreen(link);
    } else if (channel === 'email') {
      var subject = currentShareData.ownerFirstName + ' wants your vote';
      var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!isTouch) {
        showEmailPanel(subject, fullText, link);
        return;
      }
      window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(fullText);
      showSentScreen(link);
    } else if (channel === 'sms') {
      window.location.href = 'sms:?&body=' + encodeURIComponent(fullText);
      showSentScreen(link);
    } else if (channel === 'copy') {
      copyToClipboard(url);
    }
  }

  function showEmailPanel(subject, body, link) {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-sent').dataset.visible = 'false';

    var emailPanel = sheetOverlay.querySelector('#pvb-email-panel');
    if (!emailPanel) {
      emailPanel = el('div', 'pvb-email-panel', { id: 'pvb-email-panel' });
      emailPanel.innerHTML =
        '<p class="pvb-email-panel-title">Open your email</p>' +
        '<div class="pvb-email-buttons">' +
          '<button type="button" class="pvb-email-btn" data-provider="gmail">Gmail</button>' +
          '<button type="button" class="pvb-email-btn" data-provider="outlook">Outlook</button>' +
          '<button type="button" class="pvb-email-btn" data-provider="copy">Copy Message</button>' +
        '</div>' +
        '<button type="button" class="pvb-email-done">Done</button>';
      sheetOverlay.querySelector('.pvb-share-body').appendChild(emailPanel);
    }

    emailPanel.querySelector('.pvb-email-buttons').onclick = function(e) {
      var provider = e.target.dataset.provider;
      if (!provider) return;
      var subjectEnc = encodeURIComponent(subject);
      var bodyEnc = encodeURIComponent(body);
      if (provider === 'gmail') {
        window.open('https://mail.google.com/mail/?view=cm&fs=1&su=' + subjectEnc + '&body=' + bodyEnc, '_blank');
        showSentScreen(link);
      } else if (provider === 'outlook') {
        window.open('https://outlook.live.com/mail/0/deeplink/compose?subject=' + subjectEnc + '&body=' + bodyEnc, '_blank');
        showSentScreen(link);
      } else if (provider === 'copy') {
        var fullMsg = subject + '\n\n' + body;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(fullMsg).then(function() {
            e.target.textContent = 'Copied';
          }).catch(function() {
            e.target.textContent = 'Failed';
          });
        } else {
          copyFallback(fullMsg, e.target);
        }
      }
    };

    emailPanel.querySelector('.pvb-email-done').onclick = function() {
      showSentScreen(link);
    };

    emailPanel.dataset.visible = 'true';
  }

  function sendChannelEvent(channel, boardId) {
    var apiUrl = ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/') +
      'apps/board/api/e';
    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ type: 'share_channel', boardId: boardId, meta: { channel: channel } }),
      keepalive: true
    }).catch(function () {});
  }

  function copyToClipboard(text) {
    var label = document.getElementById('pvb-copy-label');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { if (label) label.textContent = 'Copied'; }).catch(function () { copyFallback(text, label); });
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
    try { document.execCommand('copy'); if (label) label.textContent = 'Copied'; } catch (e) { if (label) label.textContent = 'Failed'; }
    document.body.removeChild(ta);
  }

  // ─── Share Again Handler ────────────────────────────────────────────────────
  function handleShareAgain() {
    if (!currentShareData) return;
    if (currentShareData.links.length > 1 || (currentShareData.links[0] && currentShareData.links[0].kind === 'group')) {
      showLinksScreen();
    } else {
      showChannelsForLink(currentShareData.links[0]);
    }
  }

  // ─── Sent Screen ────────────────────────────────────────────────────────────
  function showSentScreen(link) {
    formElement.style.display = 'none';
    sheetOverlay.querySelector('#pvb-channels').dataset.visible = 'false';
    sheetOverlay.querySelector('#pvb-footer').style.display = 'none';
    var emailPanel = sheetOverlay.querySelector('#pvb-email-panel');
    if (emailPanel) emailPanel.dataset.visible = 'false';

    var sentSection = sheetOverlay.querySelector('#pvb-sent');
    sentSection.dataset.visible = 'true';

    var name = link && link.name ? link.name : currentShareData.links[0].name;
    document.getElementById('pvb-sent-name').textContent = name;
    document.getElementById('pvb-sent-body').textContent =
      "We'll let you know the moment " + name + " votes. Your board stays saved here.";

    var moreLink = document.getElementById('pvb-sent-more');
    if (moreLink) moreLink.style.display = '';
  }

  // ─── Initialize ─────────────────────────────────────────────────────────────
  window.addEventListener('pvb:share-request', openSheet);
})();
