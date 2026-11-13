/**
 * Results page client-side logic.
 * State A: voting done (VOTED) - shows loved/maybe/pass with cart handoff.
 * State B: still voting (SHARED) - shows progress with copy link.
 */
(function () {
  "use strict";

  // Parse embedded data
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

  const { shopName, partnerFirstName, status, voted, total, shareUrl, boardId, items, copy, lovedTotalFormatted } = DATA;
  const routes = window.__PVB_ROUTES || {
    root: "/",
    cart: "/cart.js",
    cartAdd: "/cart/add.js",
    cartUpdate: "/cart/update.js",
    cartPage: "/cart",
  };

  if (!items) return;

  const page = document.querySelector(".pvb-results-page");
  if (!page) return;

  // Escape HTML special chars
  function esc(s) {
    if (!s) return "";
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Group items by verdict
  const loved = [];
  const maybe = [];
  const pass = [];
  const unvoted = [];

  for (const it of items) {
    if (it.verdict === "LOVE") loved.push(it);
    else if (it.verdict === "MAYBE") maybe.push(it);
    else if (it.verdict === "PASS") pass.push(it);
    else unvoted.push(it);
  }

  // Available loved items for cart
  const lovedAvailable = loved.filter((i) => i.available);
  const lovedUnavailable = loved.filter((i) => !i.available);

  // Cart state
  let adding = false;
  const addedItems = new Set();

  // Toast notification
  let toastEl = null;
  let toastTimer = null;

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

  // Copy to clipboard with fallback
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for older browsers
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ---- Cart API helpers ----

  async function getCart() {
    const r = await fetch(routes.cart, { credentials: "same-origin" });
    if (!r.ok) throw new Error("cart_fetch");
    return r.json();
  }

  // Add a single variant to cart. Returns true if added, false if 422.
  async function addOneToCart(variantId) {
    const r = await fetch(routes.cartAdd, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
    });
    if (r.status === 422) return false;
    if (!r.ok) throw new Error("cart_add");
    return true;
  }

  // Add multiple variants. Returns { added: [...], failed: [...] }
  async function addManyToCart(variantIds) {
    const validIds = variantIds.filter((id) => id && id > 0);
    if (validIds.length === 0) return { added: [], failed: [] };

    // Try batch add first
    const payload = { items: validIds.map((id) => ({ id, quantity: 1 })) };
    const r = await fetch(routes.cartAdd, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Batch succeeded
    if (r.ok) {
      return { added: validIds, failed: [] };
    }

    // Batch failed with 422: add one at a time
    if (r.status === 422) {
      const added = [];
      const failed = [];

      for (const id of validIds) {
        const ok = await addOneToCart(id);
        if (ok) {
          added.push(id);
        } else {
          failed.push(id);
        }
      }

      return { added, failed };
    }

    // Other error
    throw new Error("cart_add");
  }

  async function setCartAttributes(attrs) {
    const r = await fetch(routes.cartUpdate, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs }),
    });
    if (!r.ok) throw new Error("cart_attrs");
    return r.json();
  }

  // ---- Add loved to cart flow ----

  async function addLovedToCart(btn) {
    if (adding || lovedAvailable.length === 0) return;
    adding = true;

    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Adding...";

    try {
      // Check what's already in cart
      const cart = await getCart();
      const inCart = new Set(cart.items.map((i) => String(i.variant_id)));
      const toAdd = lovedAvailable
        .filter((i) => !inCart.has(String(i.variantId)))
        .map((i) => i.variantId);

      if (toAdd.length === 0) {
        // All already in cart
        await setCartAttributes({ _pvb_board: String(boardId), _pvb_source: "results" });
        window.location.href = routes.cartPage;
        return;
      }

      const { added, failed } = await addManyToCart(toAdd);

      if (added.length === 0) {
        // Nothing was added
        btn.disabled = false;
        btn.textContent = origText;
        showToast("Couldn't add to your cart. Please try again.");
        adding = false;
        return;
      }

      // Set cart attributes
      await setCartAttributes({ _pvb_board: String(boardId), _pvb_source: "results" });

      if (failed.length > 0) {
        // Some failed: show notice, change button to View Cart
        const failedItems = lovedAvailable.filter((i) => failed.includes(i.variantId));
        let notice;
        if (failedItems.length === 1) {
          notice = `${failedItems[0].title} couldn't be added, it may have just sold out.`;
        } else {
          notice = `${failedItems.length} pieces couldn't be added, they may have just sold out.`;
        }
        showToast(notice, 5000);

        // Change button to View Cart link
        btn.textContent = "View Cart";
        btn.disabled = false;
        btn.onclick = () => {
          window.location.href = routes.cartPage;
        };
        adding = false;
      } else {
        // All added: redirect to cart
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

  // ---- Add single item to cart (Maybe section) ----

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
      btn.textContent = "Added";
      btn.classList.add("added");

      // Add View Cart link
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

  // ---- Build item row HTML ----

  function itemRow(item, showTag, tagClass, tagText, showAddBtn) {
    const img = item.image
      ? `<img class="pvb-item-img" src="${esc(item.image)}" alt="">`
      : `<div class="pvb-item-img"></div>`;

    const unavailClass = !item.available && item.verdict === "LOVE" ? " unavailable" : "";
    const waitClass = !item.verdict ? " waiting" : "";

    let rightHtml = "";
    if (!item.available && item.verdict === "LOVE") {
      rightHtml = `<span class="pvb-tag pvb-tag-sold">Sold Out</span>`;
    } else if (showTag) {
      rightHtml = `<span class="pvb-tag ${tagClass}">${tagText}</span>`;
    }
    if (showAddBtn && item.available) {
      rightHtml += `<button class="pvb-btn-sm pvb-add-single" data-variant="${item.variantId}">Add to Cart</button>`;
    }

    const meta = item.verdict ? item.price : "Waiting for a vote";

    return `<div class="pvb-item${unavailClass}${waitClass}" data-id="${item.variantId}">
      ${img}
      <div class="pvb-item-info">
        <p class="pvb-item-title">${esc(item.title)}</p>
        <p class="pvb-item-meta">${esc(meta)}</p>
      </div>
      <div class="pvb-item-right">${rightHtml}</div>
    </div>`;
  }

  // ---- Build section HTML ----

  function section(title, count, itemsArr, tagClass, tagText, showAddBtn, collapsed) {
    if (itemsArr.length === 0) return "";

    const toggleId = `pvb-section-${title.toLowerCase().replace(/\s/g, "-")}`;
    let html = `<div class="pvb-section">
      <div class="pvb-section-header">
        <h2 class="pvb-section-title">${esc(title)} · ${count}</h2>`;

    if (collapsed) {
      html += `<button class="pvb-toggle" data-target="${toggleId}">Show</button>`;
    }

    html += `</div>
      <div class="pvb-items${collapsed ? " pvb-hidden" : ""}" id="${toggleId}">`;

    for (const it of itemsArr) {
      html += itemRow(it, true, tagClass, tagText, showAddBtn);
    }

    html += `</div></div>`;
    return html;
  }

  // ---- Render State A: voting done ----

  function renderVoted() {
    const initial = partnerFirstName ? partnerFirstName.charAt(0).toUpperCase() : "?";

    const headline =
      loved.length > 0
        ? (copy.resultsHeadline || "{partner} loved {loved} of {total}.")
            .replace("{partner}", partnerFirstName)
            .replace("{loved}", loved.length)
            .replace("{total}", total)
        : (copy.resultsNoneLoved || "{partner} didn't love any of these.").replace(
            "{partner}",
            partnerFirstName
          );

    // Notice for unavailable loved items
    let noticeHtml = "";
    if (lovedUnavailable.length === 1) {
      noticeHtml = `<div class="pvb-notice">${esc(lovedUnavailable[0].title)} is sold out, so it won't be added to your cart. It stays on your board.</div>`;
    } else if (lovedUnavailable.length > 1) {
      noticeHtml = `<div class="pvb-notice">${lovedUnavailable.length} loved pieces are sold out, so they won't be added to your cart.</div>`;
    }

    let html = `
      <header class="pvb-top-bar">
        <p class="pvb-shop-name">${esc(shopName)}</p>
      </header>
      <div class="pvb-hero">
        <div class="pvb-avatar">${initial}</div>
        <h1 class="pvb-headline">${esc(headline)}</h1>
      </div>`;

    html += noticeHtml;
    html += section("Loved", loved.length, loved, "pvb-tag-love", "Loved", false, false);
    html += section("Maybe", maybe.length, maybe, "pvb-tag-maybe", "Maybe", true, false);
    html += section("Not For Us", pass.length, pass, "pvb-tag-pass", "Not For Us", false, true);

    // Sticky bar with CTA
    let stickyHtml = "";
    if (lovedAvailable.length > 0) {
      const ctaText =
        lovedUnavailable.length > 0
          ? `Add ${lovedAvailable.length} Loved ${lovedAvailable.length === 1 ? "Piece" : "Pieces"} to Cart · ${lovedTotalFormatted}`
          : (copy.resultsCta || "Add Loved to Cart") + ` · ${lovedTotalFormatted}`;

      stickyHtml = `
        <div class="pvb-sticky">
          <button class="pvb-btn-primary pvb-add-loved">${esc(ctaText)}</button>
          <p class="pvb-sticky-note">Opens your cart. Nothing is charged yet.</p>
        </div>`;
    } else {
      stickyHtml = `
        <div class="pvb-sticky">
          <a href="${esc(routes.root)}" class="pvb-btn-primary">Keep Shopping</a>
        </div>`;
    }

    html += stickyHtml;
    page.innerHTML = html;

    // Bind event handlers
    const addLovedBtn = page.querySelector(".pvb-add-loved");
    if (addLovedBtn) {
      addLovedBtn.addEventListener("click", () => addLovedToCart(addLovedBtn));
    }

    page.querySelectorAll(".pvb-add-single").forEach((btn) => {
      const vid = parseInt(btn.dataset.variant, 10);
      const item = items.find((i) => i.variantId === vid);
      if (item) {
        btn.addEventListener("click", () => addSingleToCart(item, btn));
      }
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

  // ---- Render State B: still voting ----

  function renderVoting() {
    const headline =
      voted > 0
        ? (copy.resultsWaitingHeadline || "{partner} is voting.").replace(
            "{partner}",
            partnerFirstName
          )
        : `${partnerFirstName} hasn't started yet.`;

    const subline = `${voted} of ${total} pieces so far. This page updates when you open it again.`;

    // Progress bar
    let progressHtml = `<div class="pvb-progress-bar">`;
    for (let i = 0; i < total; i++) {
      progressHtml += `<div class="pvb-progress-seg${i < voted ? " done" : ""}"></div>`;
    }
    progressHtml += `</div>`;

    // All items sorted: voted first, then unvoted
    const allSorted = [...loved, ...maybe, ...pass, ...unvoted];
    let itemsHtml = `<div class="pvb-section">
      <h2 class="pvb-section-title">So Far</h2>
      <div class="pvb-items">`;

    for (const it of allSorted) {
      let tagClass = "";
      let tagText = "";
      if (it.verdict === "LOVE") {
        tagClass = "pvb-tag-love";
        tagText = "Loved";
      } else if (it.verdict === "MAYBE") {
        tagClass = "pvb-tag-maybe";
        tagText = "Maybe";
      } else if (it.verdict === "PASS") {
        tagClass = "pvb-tag-pass";
        tagText = "Not For Us";
      }
      itemsHtml += itemRow(it, !!it.verdict, tagClass, tagText, false);
    }
    itemsHtml += `</div></div>`;

    let html = `
      <header class="pvb-top-bar">
        <p class="pvb-shop-name">${esc(shopName)}</p>
      </header>
      <div class="pvb-hero">
        <div class="pvb-avatar">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="pvb-headline">${esc(headline)}</h1>
        <p class="pvb-subline">${esc(subline)}</p>
      </div>`;

    html += progressHtml;
    html += itemsHtml;

    html += `
      <div class="pvb-copy-row">
        <button class="pvb-btn-outline pvb-copy-link">Copy ${esc(partnerFirstName)}'s Link</button>
        <p class="pvb-copy-note">Send it again if ${esc(partnerFirstName)} lost it.</p>
      </div>`;

    page.innerHTML = html;

    // Bind copy button
    const copyBtn = page.querySelector(".pvb-copy-link");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const ok = await copyToClipboard(shareUrl);
        if (ok) {
          const orig = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = orig;
          }, 2000);
        } else {
          showToast("Couldn't copy link.");
        }
      });
    }
  }

  // ---- Entry point ----
  if (status === "VOTED") {
    renderVoted();
  } else {
    renderVoting();
  }
})();
