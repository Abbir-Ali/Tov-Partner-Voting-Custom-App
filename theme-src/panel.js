/**
 * PVB Panel: drawer panel with items, cart, share.
 * Lazy-loaded by pill.js. Requires core.js (window.__pvb).
 * Exposes window.__pvbPanel = { open, close }.
 */
(function () {
  'use strict';

  if (window.__pvbPanel) return;

  var pvb = window.__pvb;
  if (!pvb) return;

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
  var shareBtn = q('.pvb-share-btn');
  var shareError = q('.pvb-share-error');

  if (!pill || !panel || !overlay) return;

  var moneyFormat = drawer.dataset.moneyFormat || '{{amount}}';
  var cartAddUrl = drawer.dataset.cartAddUrl || '/cart/add.js';
  var cartJsonUrl = drawer.dataset.cartJsonUrl || '/cart.js';
  var cartUrl = drawer.dataset.cartUrl || '/cart';
  var shareAssetUrl = drawer.dataset.shareAssetUrl || '';
  var shareLabel = drawer.dataset.shareLabel || 'Get a Second Opinion';

  var lastFocused = null;
  var currentPrices = {};
  var renderGeneration = 0;
  var shareLoading = false;
  var shareLoaded = false;

  panel.setAttribute('tabindex', '-1');

  // Avatar backgrounds and sprite (v3)
  var AVATAR_BG = {ava:'#F9D2D2',omar:'#E8EEF2',mei:'#F1ECE5',lily:'#F9D2D2',jay:'#DCE3E1',leo:'#F1ECE5',sara:'#F9D2D2',sam:'#DCE3E1'};
  var avatarSpriteInjected = false;
  function ensureAvatarSprite() {
    if (avatarSpriteInjected) return;
    avatarSpriteInjected = true;
    var s = document.createElement('div');
    s.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="pvb-av-ava" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M30 42c-3-14 6-24 18-24s21 9 18 24c3 9 4 21 1 30-4 4-11 3-14 1l-10-1c-5 2-10 2-13-1-3-9-3-20 0-29z" fill="#A0522D"/><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#2F3B55"/><path d="M38 69c3 7 17 7 20 0l4 27H34z" fill="#F1E3D3"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#F6D5BC"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#d3b7a1"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#d3b7a1"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#d3b7a1"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#F6D5BC"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#804124" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#b19987" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><g fill="none" stroke="#2B2526" stroke-width="1.6"><circle cx="42" cy="44.5" r="4.6"/><circle cx="54" cy="44.5" r="4.6"/><path d="M46.6 44.2h2.8M37.4 43.5l-3.4-1M58.6 43.5l3.4-1"/></g><path d="M33 40c1-11 8-17 15-17 8 0 14 5 15 13-7-1-12-4-15-8-3 6-9 10-15 12z" fill="#A0522D"/><path d="M44 25c4 0 9 2 11 6" fill="none" stroke="#c86638" stroke-width="1.6" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-omar" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#7F9CB8"/><path d="M39 69c3 6 15 6 18 0l2 27H37z" fill="#FFFFFF"/><path d="M37 70l-6 10 6 2M59 70l6 10-6 2" fill="none" stroke="#5F7C98" stroke-width="2" stroke-linejoin="round"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#E9BE98"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#c8a382"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#c8a382"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#c8a382"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#E9BE98"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#3b281e" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#a7886d" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><path d="M32 40c-2-12 5-20 13-21 3-3 9-3 12 0 7 1 10 9 7 19-2-5-5-8-8-9-2 3-7 4-11 3-4 2-9 4-13 8z" fill="#4A3326"/><path d="M45 21c3-2 7-1 9 1" fill="none" stroke="#634433" stroke-width="1.5" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-mei" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><circle cx="48" cy="17" r="7.5" fill="#2E2A33"/><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#E2826F"/><path d="M14 84h68M12 91h72" stroke="#F6D9CF" stroke-width="2.4"/><path d="M40 69c3 4 13 4 16 0" fill="none" stroke="#C9665A" stroke-width="2.4" stroke-linecap="round"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#F0C8A4"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#ceac8d"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#ceac8d"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#ceac8d"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#F0C8A4"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#242128" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#ac9076" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><path d="M33 41c0-11 6-18 15-18s15 7 15 18c-2-6-7-10-15-11-8 1-13 5-15 11z" fill="#2E2A33"/><path d="M33 41c0 5 1 9 2 11M63 41c0 5-1 9-2 11" fill="none" stroke="#2E2A33" stroke-width="2" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-lily" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M30 44c-2-14 6-23 18-23s20 9 18 23c1 6 1 12-1 15-5 1-10 0-12-2H43c-2 2-7 3-12 2-2-3-2-9-1-15z" fill="#E9C77B"/><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#E7B8BE"/><g fill="#FFFFFF" opacity=".85"><path d="M27 82c0-2 3-2 3 0 0-2 3-2 3 0 0 2-3 4-3 4s-3-2-3-4z"/><path d="M63 86c0-2 3-2 3 0 0-2 3-2 3 0 0 2-3 4-3 4s-3-2-3-4z"/><path d="M45 90c0-2 3-2 3 0 0-2 3-2 3 0 0 2-3 4-3 4s-3-2-3-4z"/></g><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#F7DAC3"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#d4bba7"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#d4bba7"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#d4bba7"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#F7DAC3"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#ba9f62" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#b19c8c" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><path d="M32 42c0-12 7-19 17-19 9 0 15 6 15 15-8 0-15-3-19-9-2 6-7 11-13 13z" fill="#E9C77B"/><path d="M50 25c5 1 9 4 11 9" fill="none" stroke="#ffde89" stroke-width="1.6" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-jay" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#4B4F63"/><path d="M38 69c3 5 17 5 20 0" fill="none" stroke="#3A3D4E" stroke-width="2.4" stroke-linecap="round"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#7A4A32"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#683f2b"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#683f2b"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#683f2b"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#7A4A32"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#1F1A1A" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#573524" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><g fill="none" stroke="#1F1A1A" stroke-width="1.7"><rect x="37" y="40.5" width="9.6" height="7.5" rx="2"/><rect x="49.4" y="40.5" width="9.6" height="7.5" rx="2"/><path d="M46.6 43.5h2.8"/></g><g fill="#1F1A1A"><circle cx="37" cy="31" r="5"/><circle cx="43" cy="26" r="5.5"/><circle cx="50" cy="24.5" r="5.5"/><circle cx="57" cy="27" r="5.2"/><circle cx="61" cy="32" r="4.6"/><circle cx="34.5" cy="36" r="3.6"/><circle cx="62.8" cy="37" r="3.4"/></g></g></symbol><symbol id="pvb-av-leo" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#B5554B"/><path d="M24 74v22M36 70v26M60 70v26M72 74v22M12 86h72" stroke="#8E3F37" stroke-width="2"/><path d="M41 69l7 8 7-8" fill="none" stroke="#F1ECE5" stroke-width="2.4" stroke-linejoin="round"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#F0C9A8"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#ceac90"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#ceac90"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#ceac90"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#F0C9A8"/><path d="M33 46c1 9 7 16 15 16s14-7 15-16c-3 4-6 5-9 4-2 2-10 2-12 0-3 1-6 0-9-4z" fill="#6B4A35"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#553b2a" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#ac9078" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><g fill="none" stroke="#2B2526" stroke-width="1.6"><rect x="37" y="40.5" width="9.6" height="7.5" rx="3.6"/><rect x="49.4" y="40.5" width="9.6" height="7.5" rx="3.6"/><path d="M46.6 43.5h2.8"/></g><path d="M32 40c-1-12 6-19 16-19 9 0 15 5 16 14-5-5-11-6-16-5-6-2-11 0-16 10z" fill="#6B4A35"/><path d="M40 24c4-2 9-2 13 0" fill="none" stroke="#8b6044" stroke-width="1.5" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-sara" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M28 46c0-17 9-27 20-27s20 10 20 27c0 9-2 16-6 22-4 5-24 5-28 0-4-6-6-13-6-22z" fill="#8FA58A"/><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#6E7B5A"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#ba8d6c"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#ba8d6c"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#D9A57E"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#495545" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#9c765a" stroke-width="1.3" stroke-linecap="round"/><path d="M43.5 53q4.5 4.6 9 0q-4.5 1.6-9 0z" fill="#8A3D3E"/><path d="M44.6 53.5q3.4 1 6.8 0" fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/><path d="M32 44c0-12 7-20 16-20s16 8 16 20c-2-8-8-13-16-13s-14 5-16 13z" fill="#8FA58A"/><path d="M33 41c3-9 9-13 15-13" fill="none" stroke="#A9BCA4" stroke-width="1.6" stroke-linecap="round"/></g></symbol><symbol id="pvb-av-sam" viewBox="0 0 96 96"><g transform="translate(-6 -1) scale(1.12)"><path d="M10 96c2-17 16-27 38-27s36 10 38 27z" fill="#82736C"/><path d="M39 69l9 14 9-14" fill="#F1ECE5"/><circle cx="48" cy="88" r="1.3" fill="#5E524C"/><circle cx="48" cy="93" r="1.3" fill="#5E524C"/><path d="M41 56h14v13c-2 4-12 4-14 0z" fill="#F2D0B6"/><path d="M41 60c4 3 10 3 14 0v-4H41z" fill="#d0b29c"/><ellipse cx="33.5" cy="45" rx="3.2" ry="4.6" fill="#d0b29c"/><ellipse cx="62.5" cy="45" rx="3.2" ry="4.6" fill="#d0b29c"/><path d="M33 40c0-10 6.5-17 15-17s15 7 15 17v4c0 9.5-6.5 17-15 17s-15-7.5-15-17z" fill="#F2D0B6"/><path d="M42 51.5c2-2 10-2 12 0-1.5 2-10.5 2-12 0z" fill="#C9C4C0"/><circle cx="39.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><circle cx="56.5" cy="50" r="3" fill="#E8868A" opacity=".22"/><ellipse cx="42" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><ellipse cx="54" cy="44.5" rx="1.7" ry="2.2" fill="#2B2526"/><path d="M38.8 40.2q3-2 6 -.4M51.2 39.8q3-1.6 6 .4" fill="none" stroke="#a09c99" stroke-width="1.6" stroke-linecap="round"/><path d="M48.4 45.5q-1.8 4.2.8 4.6" fill="none" stroke="#ae9583" stroke-width="1.3" stroke-linecap="round"/><path d="M44.5 53.4q3.5 2.6 7 0" fill="none" stroke="#8A3D3E" stroke-width="1.6" stroke-linecap="round"/><path d="M33 41c-1-6 1-11 4-13 1 3 1 7 0 13zM63 41c1-6-1-11-4-13-1 3-1 7 0 13z" fill="#C9C4C0"/><path d="M37 28c5-5 17-5 22 0-6-2-16-2-22 0z" fill="#C9C4C0"/></g></symbol></svg>';
    document.body.appendChild(s.firstChild);
  }

  // ─── Skeletons ────────────────────────────────────────────────────────────
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

  // ─── Subline ──────────────────────────────────────────────────────────────
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

  // ─── Render Items ─────────────────────────────────────────────────────────
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

  // ─── Open / Close ─────────────────────────────────────────────────────────
  function openDrawer() {
    if (overlay.dataset.open === 'true') return;
    lastFocused = document.activeElement;
    overlay.dataset.open = 'true';
    pill.setAttribute('aria-expanded', 'true');
    panel.focus();
    pvb.dispatchEvent('pvb:drawer-open', { count: pvb.getCount() });
    pvb.publishEvent('drawer_open', { count: pvb.getCount() });
    pvb.lockScroll();
    renderItems();
  }

  function closeDrawer() {
    if (overlay.dataset.open !== 'true') return;
    overlay.dataset.open = 'false';
    pill.setAttribute('aria-expanded', 'false');
    pvb.unlockScroll();
    if (lastFocused) {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  // ─── Focus Trap ───────────────────────────────────────────────────────────
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

  // ─── Add All to Cart ──────────────────────────────────────────────────────
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
          pvb.publishEvent('drawer_add_all', { count: toAdd.length });
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

  // ─── Share Script Loader ──────────────────────────────────────────────────
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

  // ─── Shared Row ───────────────────────────────────────────────────────────
  // Capitalize first letter for display if all lowercase
  function capitalizeFirst(str) {
    if (!str) return str;
    if (str === str.toLowerCase()) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }
    return str;
  }

  function renderSharedRow() {
    var footer = q('.pvb-drawer-footer'), row = q('.pvb-shared-row'), h, e;
    if (!footer) return;
    try { h = JSON.parse(localStorage.getItem('pvb:shares:v1') || '[]'); } catch (x) { h = []; }
    if (!h.length) { if (row) row.dataset.visible = 'false'; return; }
    e = h[0];
    if (!row) {
      row = document.createElement('div');
      row.className = 'pvb-shared-row';
      footer.prepend(row);
    }
    row.innerHTML = '';

    // Voter faces (up to 5, 24px, overlap -6px, 2px Taupe ring)
    var avatars = e.voterAvatars || [];
    if (avatars.length > 0) {
      ensureAvatarSprite();
      var facesWrap = document.createElement('div');
      facesWrap.className = 'pvb-shared-faces';
      var shown = avatars.slice(0, 5);
      for (var i = 0; i < shown.length; i++) {
        var key = shown[i] || 'ava';
        var bg = AVATAR_BG[key] || '#F9D2D2';
        var face = document.createElement('span');
        face.className = 'pvb-shared-face';
        face.style.cssText = 'width:24px;height:24px;border-radius:999px;background:' + bg + ';box-shadow:0 0 0 2px #F1ECE5;display:flex;align-items:flex-end;justify-content:center;flex-shrink:0;margin-left:' + (i === 0 ? '0' : '-6px');
        face.innerHTML = '<svg viewBox="0 0 96 96" width="24" height="24" style="border-radius:999px;overflow:hidden;display:block"><use href="#pvb-av-' + key + '"/></svg>';
        facesWrap.appendChild(face);
      }
      row.appendChild(facesWrap);
    } else {
      // Fallback: Icon circle with check SVG
      var iconWrap = document.createElement('div');
      iconWrap.className = 'pvb-shared-icon';
      iconWrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      row.appendChild(iconWrap);
    }

    // Text block
    var textWrap = document.createElement('div');
    textWrap.className = 'pvb-shared-text';
    var line1 = document.createElement('div');
    line1.className = 'pvb-shared-line1';

    // Build "Shared with" text from voterNames array or legacy partnerFirstName
    var names = e.voterNames || (e.partnerFirstName ? [e.partnerFirstName] : []);
    var sharedText = 'Shared';
    if (names.length === 1) {
      sharedText = 'Shared with ' + capitalizeFirst(names[0]);
    } else if (names.length === 2) {
      sharedText = 'Shared with ' + capitalizeFirst(names[0]) + ' and ' + capitalizeFirst(names[1]);
    } else if (names.length > 2) {
      var allNames = names.map(capitalizeFirst);
      sharedText = 'Shared with ' + allNames.slice(0, -1).join(', ') + ' and ' + allNames[allNames.length - 1];
    }
    if (e.hasGroupLink) sharedText += ' + group link';
    line1.textContent = sharedText;

    var line2 = document.createElement('div');
    line2.className = 'pvb-shared-line2';
    line2.textContent = 'See their votes anytime';
    textWrap.appendChild(line1);
    textWrap.appendChild(line2);
    row.appendChild(textWrap);

    // View Results link (only if resultsUrl is valid)
    var base = window.location.origin + ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/') + 'apps/board/';
    if (e.resultsUrl && e.resultsUrl.indexOf(base) === 0) {
      var link = document.createElement('a');
      link.className = 'pvb-shared-link';
      link.href = e.resultsUrl;
      link.textContent = 'View Results';
      row.appendChild(link);
    }

    row.dataset.visible = 'true';
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeDrawer();
  });

  document.addEventListener('keydown', function (e) {
    // Don't close drawer on Escape if share sheet is open (it handles its own Escape)
    var shareOpen = document.querySelector('.pvb-share-overlay[data-open="true"]');
    if (e.key === 'Escape' && overlay.dataset.open === 'true' && !shareOpen) closeDrawer();
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

  window.addEventListener('pvb:saved', renderItems);
  window.addEventListener('pvb:removed', renderItems);
  window.addEventListener('pvb:shared', renderSharedRow);

  renderSharedRow();

  // ─── Public API ───────────────────────────────────────────────────────────
  window.__pvbPanel = {
    open: openDrawer,
    close: closeDrawer
  };
})();
