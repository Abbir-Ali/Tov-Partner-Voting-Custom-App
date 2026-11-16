/**
 * Results page client-side logic.
 * Supports single-voter (legacy) and multi-voter (group) boards.
 * State A: voting done (VOTED) - shows loved/maybe/pass with cart handoff.
 * State B: still voting (SHARED) - shows progress with copy link.
 */
(function () {
  "use strict";

  const dataEl = document.getElementById("pvb-data");
  if (!dataEl) return;

  let DATA;
  try {
    const enc = dataEl.getAttribute("data-encoding");
    if (enc === "base64") {
      const bin = atob(dataEl.textContent.trim());
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      DATA = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      DATA = JSON.parse(dataEl.textContent);
    }
  } catch (e) {
    console.error("Failed to parse pvb-data", e);
    return;
  }

  const {
    shopName, boardId, status, total, eventsUrl, lovedTotalFormatted, copy,
    partnerFirstName, shareUrl,
    isGroup, voters, votersDone, votersTotal, items
  } = DATA;
  const routes = window.__PVB_ROUTES || {
    root: "/", cart: "/cart.js", cartAdd: "/cart/add.js",
    cartUpdate: "/cart/update.js", cartPage: "/cart"
  };

  if (!items) return;
  const page = document.querySelector(".pvb-results-page");
  if (!page) return;

  // Escape HTML
  function esc(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Completed voters
  const doneVoters = (voters || []).filter((v) => v.done);
  const pendingVoters = (voters || []).filter((v) => !v.done);
  const halfVoters = doneVoters.length / 2;

  // Classify items for group view
  function classifyItems() {
    const lovedByMost = [], split = [], maybe = [], notForUs = [];
    for (const item of items) {
      const v = item.votes || {};
      const completedIds = doneVoters.map((x) => x.id);
      let loves = 0, maybes = 0, passes = 0;
      for (const vid of completedIds) {
        if (v[vid]?.verdict === "LOVE") loves++;
        else if (v[vid]?.verdict === "MAYBE") maybes++;
        else if (v[vid]?.verdict === "PASS") passes++;
      }
      const totalVoted = loves + maybes + passes;
      if (totalVoted === 0) continue;
      if (loves > halfVoters) lovedByMost.push(item);
      else if (loves > 0) split.push(item);
      else if (passes === totalVoted) notForUs.push(item);
      else maybe.push(item);
    }
    return { lovedByMost, split, maybe, notForUs };
  }

  // Get single-voter verdict (for legacy mode)
  function getVerdict(item) {
    const v = item.votes || {};
    const vid = doneVoters[0]?.id;
    return vid ? v[vid]?.verdict : null;
  }

  // Cart state
  let adding = false;
  const addedItems = new Set();
  let toastEl = null, toastTimer = null;

  // Analytics event
  function sendEvent(type, meta) {
    try {
      navigator.sendBeacon(eventsUrl || "/apps/board/api/e", JSON.stringify({
        type, boardId: String(boardId),
        valueCents: meta?.valueCents,
        meta: meta?.added !== undefined ? { added: meta.added, failed: meta.failed || 0 } : undefined
      }));
    } catch {
      // Silent fail for analytics
    }
  }

  function showToast(msg, dur = 3000) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "pvb-toast";
      page.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), dur);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch { return false; }
    }
  }

  // Cart API helpers
  async function getCart() {
    const r = await fetch(routes.cart, { credentials: "same-origin" });
    if (!r.ok) throw new Error("cart_fetch");
    return r.json();
  }

  async function addOneToCart(variantId) {
    const r = await fetch(routes.cartAdd, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] })
    });
    return r.status !== 422 && r.ok;
  }

  async function addManyToCart(variantIds) {
    const validIds = variantIds.filter((id) => id && id > 0);
    if (validIds.length === 0) return { added: [], failed: [] };
    const r = await fetch(routes.cartAdd, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: validIds.map((id) => ({ id, quantity: 1 })) })
    });
    if (r.ok) return { added: validIds, failed: [] };
    if (r.status === 422) {
      const added = [], failed = [];
      for (const id of validIds) {
        if (await addOneToCart(id)) added.push(id);
        else failed.push(id);
      }
      return { added, failed };
    }
    throw new Error("cart_add");
  }

  async function setCartAttributes(attrs) {
    const r = await fetch(routes.cartUpdate, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs })
    });
    if (!r.ok) throw new Error("cart_attrs");
    return r.json();
  }

  // Reason labels
  const REASON_LABELS = {
    color: "Color", size: "Size", price: "Price", style: "Style",
    material: "Material", comfort: "Comfort", another_color: "Another Color",
    different_size: "Different Size", lower_price: "Lower Price",
    in_person: "See It in Person", other: "Other"
  };

  function getReasonDisplay(reason, reasonText, verdict) {
    if (!reason) return null;
    const label = reason === "other" && reasonText ? reasonText : REASON_LABELS[reason];
    if (!label) return null;
    if (verdict === "PASS") return `Not right: ${label}`;
    if (verdict === "MAYBE") return `Would be a yes with: ${label}`;
    return null;
  }

  // Build item row for single voter (legacy)
  function itemRowSingle(item, showTag, tagClass, tagText, showAddBtn) {
    const verdict = getVerdict(item);
    const v = item.votes || {};
    const vid = doneVoters[0]?.id;
    const vote = vid ? v[vid] : null;
    const img = item.image
      ? `<img class="pvb-item-img" src="${esc(item.image)}" alt="">`
      : `<div class="pvb-item-img"></div>`;
    const unavailClass = !item.available && verdict === "LOVE" ? " unavailable" : "";
    const waitClass = !verdict ? " waiting" : "";
    let rightHtml = "";
    if (!item.available && verdict === "LOVE") {
      rightHtml = `<span class="pvb-tag pvb-tag-sold">Sold Out</span>`;
    } else if (showTag) {
      rightHtml = `<span class="pvb-tag ${tagClass}">${tagText}</span>`;
    }
    if (showAddBtn && item.available) {
      rightHtml += `<button class="pvb-btn-sm pvb-add-single" data-variant="${item.variantId}">Add to Cart</button>`;
    }
    const reasonDisplay = vote ? getReasonDisplay(vote.reason, vote.reasonText, verdict) : null;
    const reasonHtml = reasonDisplay ? `<p class="pvb-item-reason">${esc(reasonDisplay)}</p>` : "";
    const meta = verdict ? item.price : "Waiting for a vote";
    return `<div class="pvb-item${unavailClass}${waitClass}" data-id="${item.variantId}">
      ${img}
      <div class="pvb-item-info">
        <p class="pvb-item-title">${esc(item.title)}</p>
        <p class="pvb-item-meta">${esc(meta)}</p>
        ${reasonHtml}
      </div>
      <div class="pvb-item-right">${rightHtml}</div>
    </div>`;
  }

  // Build item row for group (Everyone tab)
  function itemRowGroup(item, section, showAddBtn) {
    const v = item.votes || {};
    const img = item.image
      ? `<img class="pvb-item-img" src="${esc(item.image)}" alt="">`
      : `<div class="pvb-item-img"></div>`;
    const unavailClass = !item.available && section === "lovedByMost" ? " unavailable" : "";

    // Build voter line: "Loved by Alex, Zaid" or "Loved: Alex · Maybe: Zaid"
    const loves = [], maybes = [], passes = [];
    for (const voter of doneVoters) {
      const vote = v[voter.id];
      if (vote?.verdict === "LOVE") loves.push(voter.firstName);
      else if (vote?.verdict === "MAYBE") maybes.push(voter.firstName);
      else if (vote?.verdict === "PASS") passes.push(voter.firstName);
    }

    let voterLine = "";
    if (section === "lovedByMost") {
      voterLine = `Loved by ${loves.join(", ")}`;
    } else if (section === "split") {
      const parts = [];
      if (loves.length) parts.push(`Loved: ${loves.join(", ")}`);
      if (maybes.length) parts.push(`Maybe: ${maybes.join(", ")}`);
      voterLine = parts.join(" · ");
    } else if (section === "maybe") {
      voterLine = maybes.length ? `Maybe: ${maybes.join(", ")}` : "";
    } else {
      voterLine = "Not For Us";
    }

    // Build reasons per voter
    let reasonsHtml = "";
    for (const voter of doneVoters) {
      const vote = v[voter.id];
      if (vote?.reason) {
        const rd = getReasonDisplay(vote.reason, vote.reasonText, vote.verdict);
        if (rd) reasonsHtml += `<p class="pvb-item-reason">${esc(voter.firstName)}: ${esc(rd)}</p>`;
      }
    }

    let rightHtml = "";
    if (!item.available && section === "lovedByMost") {
      rightHtml = `<span class="pvb-tag pvb-tag-sold">Sold Out</span>`;
    }
    if (showAddBtn && item.available) {
      rightHtml += `<button class="pvb-btn-sm pvb-add-single" data-variant="${item.variantId}">Add</button>`;
    }

    return `<div class="pvb-item${unavailClass}" data-id="${item.variantId}">
      ${img}
      <div class="pvb-item-info">
        <p class="pvb-item-title">${esc(item.title)}</p>
        <p class="pvb-item-meta">${esc(voterLine)} · ${esc(item.price)}</p>
        ${reasonsHtml}
      </div>
      <div class="pvb-item-right">${rightHtml}</div>
    </div>`;
  }

  // Build item row for per-voter tab
  function itemRowVoter(item, voterId) {
    const v = item.votes || {};
    const vote = v[voterId];
    if (!vote) return "";
    const img = item.image
      ? `<img class="pvb-item-img" src="${esc(item.image)}" alt="">`
      : `<div class="pvb-item-img"></div>`;
    const tagClass = vote.verdict === "LOVE" ? "pvb-tag-love"
      : vote.verdict === "MAYBE" ? "pvb-tag-maybe" : "pvb-tag-pass";
    const tagText = vote.verdict === "LOVE" ? "Loved"
      : vote.verdict === "MAYBE" ? "Maybe" : "Not For Us";
    const reasonDisplay = getReasonDisplay(vote.reason, vote.reasonText, vote.verdict);
    const reasonHtml = reasonDisplay ? `<p class="pvb-item-reason">${esc(reasonDisplay)}</p>` : "";
    const unavailClass = !item.available && vote.verdict === "LOVE" ? " unavailable" : "";
    let rightHtml = "";
    if (!item.available && vote.verdict === "LOVE") {
      rightHtml = `<span class="pvb-tag pvb-tag-sold">Sold Out</span>`;
    } else {
      rightHtml = `<span class="pvb-tag ${tagClass}">${tagText}</span>`;
    }
    return `<div class="pvb-item${unavailClass}" data-id="${item.variantId}">
      ${img}
      <div class="pvb-item-info">
        <p class="pvb-item-title">${esc(item.title)}</p>
        <p class="pvb-item-meta">${esc(item.price)}</p>
        ${reasonHtml}
      </div>
      <div class="pvb-item-right">${rightHtml}</div>
    </div>`;
  }

  // Section builder
  function section(title, count, html, collapsed, tabKey) {
    if (count === 0) return "";
    const prefix = tabKey ? `${tabKey}-` : "";
    const toggleId = `pvb-section-${prefix}${title.toLowerCase().replace(/\s/g, "-")}`;
    let out = `<div class="pvb-section">
      <div class="pvb-section-header">
        <h2 class="pvb-section-title">${esc(title)} · ${count}</h2>`;
    if (collapsed) {
      out += `<button class="pvb-toggle" data-target="${toggleId}">Show</button>`;
    }
    out += `</div><div class="pvb-items${collapsed ? " pvb-hidden" : ""}" id="${toggleId}">${html}</div></div>`;
    return out;
  }

  // Add loved items to cart
  async function addLovedToCart(btn, itemsToAdd) {
    if (adding || itemsToAdd.length === 0) return;
    adding = true;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Adding...";
    try {
      const cart = await getCart();
      const inCart = new Set(cart.items.map((i) => String(i.variant_id)));
      const toAdd = itemsToAdd.filter((i) => i.available && !inCart.has(String(i.variantId)))
        .map((i) => i.variantId);
      if (toAdd.length === 0) {
        await setCartAttributes({ _pvb_board: String(boardId), _pvb_source: "results" });
        window.location.href = routes.cartPage;
        return;
      }
      const { added, failed } = await addManyToCart(toAdd);
      if (added.length === 0) {
        btn.disabled = false;
        btn.textContent = origText;
        showToast("Couldn't add to your cart. Please try again.");
        adding = false;
        return;
      }
      await setCartAttributes({ _pvb_board: String(boardId), _pvb_source: "results" });
      const addedValue = itemsToAdd.filter((i) => added.includes(i.variantId))
        .reduce((sum, i) => sum + (i.priceCents || 0), 0);
      sendEvent("results_add_loved", { valueCents: addedValue, added: added.length, failed: failed.length });
      if (failed.length > 0) {
        showToast(`${failed.length} ${failed.length === 1 ? "piece" : "pieces"} couldn't be added.`, 5000);
        btn.textContent = "View Cart";
        btn.disabled = false;
        btn.onclick = () => { window.location.href = routes.cartPage; };
        adding = false;
      } else {
        window.location.href = routes.cartPage;
      }
    } catch (e) {
      console.error("Cart error", e);
      btn.disabled = false;
      btn.textContent = origText;
      showToast("Couldn't add to your cart. Please try again.");
      adding = false;
    }
  }

  // Add single item
  async function addSingleToCart(item, btn) {
    if (addedItems.has(item.variantId)) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Adding...";
    try {
      const cart = await getCart();
      const inCart = cart.items.some((i) => String(i.variant_id) === String(item.variantId));
      if (!inCart) {
        const ok = await addOneToCart(item.variantId);
        if (!ok) {
          btn.disabled = false;
          btn.textContent = origText;
          showToast(`${item.title} couldn't be added, it may have just sold out.`);
          return;
        }
      }
      await setCartAttributes({ _pvb_board: String(boardId), _pvb_source: "results" });
      addedItems.add(item.variantId);
      sendEvent("results_add_maybe", { valueCents: item.priceCents || 0 });
      btn.textContent = "Added";
      btn.classList.add("added");
      const link = document.createElement("a");
      link.href = routes.cartPage;
      link.className = "pvb-btn-sm";
      link.textContent = "View Cart";
      btn.parentNode.appendChild(link);
    } catch (e) {
      console.error("Cart error", e);
      btn.disabled = false;
      btn.textContent = origText;
      showToast("Couldn't add to your cart. Please try again.");
    }
  }

  // Render single-voter voted state (legacy)
  function renderVotedSingle() {
    const loved = items.filter((i) => getVerdict(i) === "LOVE");
    const maybe = items.filter((i) => getVerdict(i) === "MAYBE");
    const pass = items.filter((i) => getVerdict(i) === "PASS");
    const lovedAvailable = loved.filter((i) => i.available);
    const lovedUnavailable = loved.filter((i) => !i.available);
    const initial = partnerFirstName ? partnerFirstName.charAt(0).toUpperCase() : "?";
    const headline = loved.length > 0
      ? (copy.resultsHeadline || "{partner} loved {loved} of {total}.")
          .replace("{partner}", partnerFirstName).replace("{loved}", loved.length).replace("{total}", total)
      : (copy.resultsNoneLoved || "{partner} didn't love any of these.").replace("{partner}", partnerFirstName);
    let noticeHtml = "";
    if (lovedUnavailable.length === 1) {
      noticeHtml = `<div class="pvb-notice">${esc(lovedUnavailable[0].title)} is sold out, so it won't be added to your cart.</div>`;
    } else if (lovedUnavailable.length > 1) {
      noticeHtml = `<div class="pvb-notice">${lovedUnavailable.length} loved pieces are sold out.</div>`;
    }
    let html = `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(shopName)}</p></header>
      <div class="pvb-hero">
        <div class="pvb-avatar">${initial}</div>
        <h1 class="pvb-headline">${esc(headline)}</h1>
      </div>`;
    html += noticeHtml;
    let lovedHtml = "";
    for (const it of loved) lovedHtml += itemRowSingle(it, true, "pvb-tag-love", "Loved", false);
    html += section("Loved", loved.length, lovedHtml, false);
    let maybeHtml = "";
    for (const it of maybe) maybeHtml += itemRowSingle(it, true, "pvb-tag-maybe", "Maybe", true);
    html += section("Maybe", maybe.length, maybeHtml, false);
    let passHtml = "";
    for (const it of pass) passHtml += itemRowSingle(it, true, "pvb-tag-pass", "Not For Us", false);
    html += section("Not For Us", pass.length, passHtml, true);

    if (lovedAvailable.length > 0) {
      const ctaText = lovedUnavailable.length > 0
        ? `Add ${lovedAvailable.length} Loved ${lovedAvailable.length === 1 ? "Piece" : "Pieces"} to Cart · ${lovedTotalFormatted}`
        : (copy.resultsCta || "Add Loved to Cart") + ` · ${lovedTotalFormatted}`;
      html += `<div class="pvb-sticky">
        <button class="pvb-btn-primary pvb-add-loved">${esc(ctaText)}</button>
        <p class="pvb-sticky-note">Opens your cart. Nothing is charged yet.</p>
      </div>`;
    } else {
      html += `<div class="pvb-sticky"><a href="${esc(routes.root)}" class="pvb-btn-primary">Keep Shopping</a></div>`;
    }
    page.innerHTML = html;
    bindEvents(lovedAvailable);
  }

  // Render group voted state
  function renderVotedGroup() {
    const classified = classifyItems();
    const lovedByMostAvail = classified.lovedByMost.filter((i) => i.available);
    const lovedByMostUnavail = classified.lovedByMost.filter((i) => !i.available);

    // Voter avatars header
    let avatarsHtml = `<div class="pvb-avatars">`;
    for (const v of voters) {
      const cls = v.done ? "pvb-avatar-sm pvb-avatar-done" : "pvb-avatar-sm pvb-avatar-pending";
      avatarsHtml += `<div class="${cls}">${v.firstName.charAt(0).toUpperCase()}</div>`;
    }
    avatarsHtml += `</div>`;

    // Headline
    const headline = `${votersDone} of ${votersTotal} have voted.`;

    // Pending voters line
    let pendingLine = "";
    if (pendingVoters.length > 0) {
      const names = pendingVoters.map((v) => v.firstName);
      const nameStr = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      pendingLine = `${nameStr} ${names.length === 1 ? "hasn't" : "haven't"} voted yet.`;
    }

    // Tabs
    let tabsHtml = `<div class="pvb-tabs">
      <button class="pvb-tab pvb-tab-active" data-tab="everyone">Everyone</button>`;
    for (const v of doneVoters) {
      tabsHtml += `<button class="pvb-tab" data-tab="${v.id}">${esc(v.firstName)}</button>`;
    }
    tabsHtml += `</div>`;

    // Everyone content
    let everyoneHtml = `<div class="pvb-tab-content pvb-tab-everyone">`;
    let lbmHtml = "";
    for (const it of classified.lovedByMost) lbmHtml += itemRowGroup(it, "lovedByMost", false);
    everyoneHtml += section("Loved by Most", classified.lovedByMost.length, lbmHtml, false, "everyone");
    let splitHtml = "";
    for (const it of classified.split) splitHtml += itemRowGroup(it, "split", true);
    everyoneHtml += section("Split", classified.split.length, splitHtml, false, "everyone");
    let maybeHtml = "";
    for (const it of classified.maybe) maybeHtml += itemRowGroup(it, "maybe", true);
    everyoneHtml += section("Maybe", classified.maybe.length, maybeHtml, false, "everyone");
    let nfuHtml = "";
    for (const it of classified.notForUs) nfuHtml += itemRowGroup(it, "notForUs", false);
    everyoneHtml += section("Not For Us", classified.notForUs.length, nfuHtml, true, "everyone");
    everyoneHtml += `</div>`;

    // Per-voter content (hidden by default)
    let voterTabsHtml = "";
    for (const voter of doneVoters) {
      const voterLoved = items.filter((i) => i.votes?.[voter.id]?.verdict === "LOVE");
      const voterMaybe = items.filter((i) => i.votes?.[voter.id]?.verdict === "MAYBE");
      const voterPass = items.filter((i) => i.votes?.[voter.id]?.verdict === "PASS");
      let vHtml = `<div class="pvb-tab-content pvb-tab-voter pvb-hidden" data-voter="${voter.id}">`;
      let vlHtml = "";
      for (const it of voterLoved) vlHtml += itemRowVoter(it, voter.id);
      vHtml += section("Loved", voterLoved.length, vlHtml, false, voter.id);
      let vmHtml = "";
      for (const it of voterMaybe) vmHtml += itemRowVoter(it, voter.id);
      vHtml += section("Maybe", voterMaybe.length, vmHtml, false, voter.id);
      let vpHtml = "";
      for (const it of voterPass) vpHtml += itemRowVoter(it, voter.id);
      vHtml += section("Not For Us", voterPass.length, vpHtml, true, voter.id);
      vHtml += `</div>`;
      voterTabsHtml += vHtml;
    }

    // Notice for unavailable
    let noticeHtml = "";
    if (lovedByMostUnavail.length === 1) {
      noticeHtml = `<div class="pvb-notice">${esc(lovedByMostUnavail[0].title)} is sold out.</div>`;
    } else if (lovedByMostUnavail.length > 1) {
      noticeHtml = `<div class="pvb-notice">${lovedByMostUnavail.length} loved pieces are sold out.</div>`;
    }

    // Copy links for pending voters
    let copyLinksHtml = "";
    if (pendingVoters.length > 0) {
      copyLinksHtml = `<div class="pvb-pending-links">`;
      for (const v of pendingVoters) {
        copyLinksHtml += `<button class="pvb-copy-voter-link" data-url="${esc(v.shareUrl)}">Copy ${esc(v.firstName)}'s Link</button>`;
      }
      copyLinksHtml += `</div>`;
    }

    let html = `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(shopName)}</p></header>
      <div class="pvb-hero">
        ${avatarsHtml}
        <h1 class="pvb-headline">${esc(headline)}</h1>
        ${pendingLine ? `<p class="pvb-subline">${esc(pendingLine)}</p>` : ""}
        ${copyLinksHtml}
      </div>`;
    html += tabsHtml;
    html += noticeHtml;
    html += everyoneHtml;
    html += voterTabsHtml;

    // Sticky CTA
    if (lovedByMostAvail.length > 0) {
      const ctaText = `Add Loved by Most to Cart · ${lovedTotalFormatted}`;
      html += `<div class="pvb-sticky">
        <button class="pvb-btn-primary pvb-add-loved">${esc(ctaText)}</button>
        <p class="pvb-sticky-note">Opens your cart. Nothing is charged yet.</p>
      </div>`;
    } else {
      html += `<div class="pvb-sticky"><a href="${esc(routes.root)}" class="pvb-btn-primary">Keep Shopping</a></div>`;
    }

    page.innerHTML = html;
    bindEvents(lovedByMostAvail);
    bindTabs();
    bindCopyVoterLinks();
  }

  // Render still-voting state (single or group)
  function renderVoting() {
    if (isGroup && votersTotal > 1) {
      renderVotingGroup();
    } else {
      renderVotingSingle();
    }
  }

  function renderVotingSingle() {
    const voted = items.filter((i) => getVerdict(i)).length;
    const headline = voted > 0
      ? (copy.resultsWaitingHeadline || "{partner} is voting.").replace("{partner}", partnerFirstName)
      : `${partnerFirstName} hasn't started yet.`;
    const subline = `${voted} of ${total} pieces so far. This page updates when you open it again.`;
    let progressHtml = `<div class="pvb-progress-bar">`;
    for (let i = 0; i < total; i++) {
      progressHtml += `<div class="pvb-progress-seg${i < voted ? " done" : ""}"></div>`;
    }
    progressHtml += `</div>`;
    let itemsHtml = `<div class="pvb-section"><h2 class="pvb-section-title">So Far</h2><div class="pvb-items">`;
    for (const it of items) {
      const verdict = getVerdict(it);
      let tagClass = "", tagText = "";
      if (verdict === "LOVE") { tagClass = "pvb-tag-love"; tagText = "Loved"; }
      else if (verdict === "MAYBE") { tagClass = "pvb-tag-maybe"; tagText = "Maybe"; }
      else if (verdict === "PASS") { tagClass = "pvb-tag-pass"; tagText = "Not For Us"; }
      itemsHtml += itemRowSingle(it, !!verdict, tagClass, tagText, false);
    }
    itemsHtml += `</div></div>`;
    let html = `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(shopName)}</p></header>
      <div class="pvb-hero">
        <div class="pvb-avatar"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
        <h1 class="pvb-headline">${esc(headline)}</h1>
        <p class="pvb-subline">${esc(subline)}</p>
      </div>`;
    html += progressHtml + itemsHtml;
    html += `<div class="pvb-copy-row">
      <button class="pvb-btn-outline pvb-copy-link">Copy ${esc(partnerFirstName)}'s Link</button>
      <p class="pvb-copy-note">Send it again if ${esc(partnerFirstName)} lost it.</p>
    </div>`;
    page.innerHTML = html;
    bindCopyLink();
  }

  function renderVotingGroup() {
    // Voter avatars header
    let avatarsHtml = `<div class="pvb-avatars">`;
    for (const v of voters) {
      const cls = v.done ? "pvb-avatar-sm pvb-avatar-done" : "pvb-avatar-sm pvb-avatar-pending";
      avatarsHtml += `<div class="${cls}">${v.firstName.charAt(0).toUpperCase()}</div>`;
    }
    avatarsHtml += `</div>`;

    // Names for waiting
    const names = pendingVoters.map((v) => v.firstName);
    const nameStr = names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} and ${names[1]}`
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    const headline = `Waiting for ${nameStr}.`;
    const subline = votersDone > 0 ? `${votersDone} of ${votersTotal} have voted.` : "No one has started yet.";

    // Copy links for pending voters
    let copyLinksHtml = `<div class="pvb-pending-links">`;
    for (const v of pendingVoters) {
      copyLinksHtml += `<button class="pvb-copy-voter-link" data-url="${esc(v.shareUrl)}">Copy ${esc(v.firstName)}'s Link</button>`;
    }
    copyLinksHtml += `</div>`;

    // Piece list (waiting for votes)
    let itemsHtml = `<div class="pvb-section"><h2 class="pvb-section-title">On The Board</h2><div class="pvb-items">`;
    for (const it of items) {
      const img = it.image
        ? `<img class="pvb-item-img" src="${esc(it.image)}" alt="">`
        : `<div class="pvb-item-img"></div>`;
      itemsHtml += `<div class="pvb-item waiting" data-id="${it.variantId}">
        ${img}
        <div class="pvb-item-info">
          <p class="pvb-item-title">${esc(it.title)}</p>
          <p class="pvb-item-meta">${esc(it.price)}</p>
        </div>
        <div class="pvb-item-right"><span class="pvb-tag pvb-tag-maybe">Waiting</span></div>
      </div>`;
    }
    itemsHtml += `</div></div>`;

    let html = `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(shopName)}</p></header>
      <div class="pvb-hero">
        ${avatarsHtml}
        <h1 class="pvb-headline">${esc(headline)}</h1>
        <p class="pvb-subline">${esc(subline)}</p>
        ${copyLinksHtml}
      </div>`;
    html += itemsHtml;
    page.innerHTML = html;
    bindCopyVoterLinks();
  }

  // Bind event handlers
  function bindEvents(lovedItems) {
    const addLovedBtn = page.querySelector(".pvb-add-loved");
    if (addLovedBtn) {
      addLovedBtn.addEventListener("click", () => addLovedToCart(addLovedBtn, lovedItems));
    }
    page.querySelectorAll(".pvb-add-single").forEach((btn) => {
      const vid = parseInt(btn.dataset.variant, 10);
      const item = items.find((i) => i.variantId === vid);
      if (item) btn.addEventListener("click", () => addSingleToCart(item, btn));
    });
    page.querySelectorAll(".pvb-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) {
          const hidden = target.classList.toggle("pvb-hidden");
          btn.textContent = hidden ? "Show" : "Hide";
        }
      });
    });
  }

  function bindTabs() {
    const tabs = page.querySelectorAll(".pvb-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("pvb-tab-active"));
        tab.classList.add("pvb-tab-active");
        const tabId = tab.dataset.tab;
        page.querySelector(".pvb-tab-everyone")?.classList.toggle("pvb-hidden", tabId !== "everyone");
        page.querySelectorAll(".pvb-tab-voter").forEach((el) => {
          el.classList.toggle("pvb-hidden", el.dataset.voter !== tabId);
        });
      });
    });
  }

  function bindCopyLink() {
    const copyBtn = page.querySelector(".pvb-copy-link");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const ok = await copyToClipboard(shareUrl);
        if (ok) {
          const orig = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => { copyBtn.textContent = orig; }, 2000);
        } else {
          showToast("Couldn't copy link.");
        }
      });
    }
  }

  function bindCopyVoterLinks() {
    page.querySelectorAll(".pvb-copy-voter-link").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.dataset.url;
        const ok = await copyToClipboard(url);
        if (ok) {
          const orig = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => { btn.textContent = orig; }, 2000);
        } else {
          showToast("Couldn't copy link.");
        }
      });
    });
  }

  // Entry point
  if (status === "VOTED" || votersDone > 0) {
    if (isGroup && votersTotal > 1) {
      renderVotedGroup();
    } else {
      renderVotedSingle();
    }
  } else {
    renderVoting();
  }
})();
