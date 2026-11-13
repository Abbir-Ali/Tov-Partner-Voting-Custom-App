/**
 * Splat route: handles /proxy and /proxy/* via the App Proxy at /apps/board.
 *
 * Routes:
 * - /<shareToken> -> Vote page
 * - /results/<ownerToken> -> Results placeholder page
 * - empty or unknown -> Not found page
 *
 * authenticate.public.appProxy throws a Response automatically when the
 * Shopify HMAC signature is missing or invalid.
 */

import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";
import {
  getBoardByShareToken,
  getBoardByOwnerToken,
  setPartnerOpenedAt,
} from "../models/board.server.js";
import { getVotesForBoard } from "../models/vote.server.js";
import { fetchVariants } from "../services/products.server.js";
import { VOTE_JS, VOTE_CSS } from "../vote-page/dist/vote-assets.server.js";
import { RESULTS_JS, RESULTS_CSS } from "../results-page/dist/results-assets.server.js";
import { checkEligibility } from "../services/products.server.js";
import { recordEvent } from "../models/events.server.js";
import { createHash } from "crypto";
import { log } from "../utils/log.server.js";

// Response headers
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Escape for Liquid: prevent HTML and Liquid injection.
 * Used for values inserted into the HTML template.
 */
function escapeForLiquid(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

/**
 * Encode data object as base64 for safe HTML/Liquid embedding.
 * Base64 contains only A-Z a-z 0-9 + / = so no escaping needed.
 */
function encodeDataAsBase64(dataObj) {
  const jsonStr = JSON.stringify(dataObj);
  // Buffer is a Node.js global
  // eslint-disable-next-line no-undef
  return Buffer.from(jsonStr, "utf8").toString("base64");
}

/**
 * Format price with currency.
 */
function formatPrice(price, currencyCode) {
  const num = parseFloat(price);
  if (isNaN(num)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

/**
 * Replace copy placeholders: {shopper}, {partner}, {count}
 */
function replacePlaceholders(text, { shopper, partner, count }) {
  return String(text ?? "")
    .replace(/\{shopper\}/gi, shopper ?? "")
    .replace(/\{partner\}/gi, partner ?? "")
    .replace(/\{count\}/gi, String(count ?? ""));
}

/**
 * Get SHA-256 hash, first 16 hex chars (for localStorage key).
 */
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * Build the vote page HTML.
 * The JS renders welcome screen then voting UI dynamically.
 */
function buildVotePage({
  board,
  items,
  votes,
  copy,
  shopName,
  shopUrl,
  proxyPath,
  storageKey,
}) {
  const placeholders = {
    shopper: board.ownerFirstName,
    partner: board.partnerFirstName,
    count: items.length,
  };

  // OG image: first item image (https)
  const firstItem = items[0];
  let ogImage = firstItem?.image || "";
  if (ogImage && !ogImage.startsWith("https://")) {
    ogImage = ogImage.replace(/^http:/, "https:");
  }

  // Build data JSON
  const dataObj = {
    board: {
      shareToken: board.shareToken,
      ownerFirstName: board.ownerFirstName,
      partnerFirstName: board.partnerFirstName,
      name: board.name,
      note: board.note,
      status: board.status,
    },
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      image: item.image,
      url: item.url,
      available: item.available,
    })),
    votes: votes.map((v) => ({
      boardItemId: v.boardItemId,
      verdict: v.verdict,
    })),
    copy: {
      stampLove: copy.loveLabel,
      stampMaybe: copy.maybeLabel,
      stampPass: copy.passLabel,
      thanksHeadline: replacePlaceholders(copy.thanksHeadline, placeholders),
      thanksBody: replacePlaceholders(copy.thanksBody, placeholders),
    },
    shopName,
    shopUrl,
    proxyPath,
    storageKey,
  };

  const dataBase64 = encodeDataAsBase64(dataObj);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeForLiquid(board.ownerFirstName)} wants your vote</title>
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
  <meta property="og:title" content="${escapeForLiquid(board.ownerFirstName)} wants your vote">
  <meta property="og:description" content="${items.length} pieces from ${escapeForLiquid(shopName)}. It only takes a minute.">
  <meta property="og:image" content="${escapeForLiquid(ogImage)}">
  <meta property="og:type" content="website">
{% raw %}
  <style>
${VOTE_CSS}
  </style>
{% endraw %}
</head>
<body>
  <div class="pvb-vote-page"></div>
  <script type="application/json" id="pvb-data" data-encoding="base64">${dataBase64}</script>
{% raw %}
  <script>
${VOTE_JS}
  </script>
{% endraw %}
</body>
</html>`;
}

/**
 * Build the results page HTML.
 * The JS renders State A (voted) or State B (voting) dynamically.
 */
function buildResultsPage({
  board,
  items,
  votes,
  settings,
  shopName,
  shopUrl,
  proxyPath,
}) {
  // Build vote map for item lookup
  const voteMap = new Map();
  for (const v of votes) voteMap.set(v.boardItemId, v.verdict);

  // Calculate loved-and-available total on the server
  let lovedAvailableTotal = 0;
  let currencyCode = null;
  for (const item of items) {
    const verdict = voteMap.get(item.id);
    if (verdict === "LOVE" && item.available) {
      lovedAvailableTotal += item.priceCents || 0;
      if (!currencyCode && item.currencyCode) {
        currencyCode = item.currencyCode;
      }
    }
  }
  // Format total with proper currency (convert cents back to dollars)
  const lovedTotalFormatted = formatPrice(lovedAvailableTotal / 100, currencyCode || "USD");

  // Build absolute events URL (works with Markets locale prefixes)
  const eventsUrl = `${proxyPath}/api/e`;

  // Build data JSON
  const dataObj = {
    shopName,
    partnerFirstName: board.partnerFirstName,
    status: board.status,
    voted: votes.length,
    total: items.length,
    shareUrl: `${shopUrl}${proxyPath}/${board.shareToken}`,
    boardId: board.id,
    lovedTotalFormatted,
    eventsUrl,
    items: items.map((item) => ({
      variantId: item.variantId,
      title: item.title,
      variantTitle: item.variantTitle,
      price: item.price,
      priceCents: item.priceCents,
      image: item.image,
      url: item.url,
      available: item.available,
      verdict: voteMap.get(item.id) || null,
    })),
    copy: {
      resultsHeadline: settings.copy.resultsHeadline,
      resultsNoneLoved: settings.copy.resultsNoneLoved,
      resultsWaitingHeadline: settings.copy.resultsWaitingHeadline,
      resultsCta: settings.copy.resultsCta,
    },
    // Liquid routes will be injected via data attributes (outside {% raw %})
  };

  const dataBase64 = encodeDataAsBase64(dataObj);

  // Routes use Liquid outside {% raw %} for Markets URLs
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Results - ${escapeForLiquid(shopName)}</title>
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
{% raw %}
  <style>
${RESULTS_CSS}
  </style>
{% endraw %}
</head>
<body>
  <div class="pvb-results-page" data-root="{{ routes.root_url }}" data-cart="{{ routes.cart_url }}"></div>
  <script type="application/json" id="pvb-data" data-encoding="base64">${dataBase64}</script>
{% raw %}
  <script>
(function(){
var p=document.querySelector('.pvb-results-page');
if(!p)return;
var cartUrl=p.getAttribute('data-cart')||'/cart';
window.__PVB_ROUTES={
root:p.getAttribute('data-root')||'/',
cart:cartUrl+'.js',
cartAdd:cartUrl+'/add.js',
cartUpdate:cartUrl+'/update.js',
cartPage:cartUrl
};
})();
${RESULTS_JS}
  </script>
{% endraw %}
</body>
</html>`;
}

/**
 * Build an error/state page (expired, not found, disabled).
 */
function buildErrorPage({ headline, body, shopName, shopUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeForLiquid(headline)} - ${escapeForLiquid(shopName)}</title>
  <meta name="robots" content="noindex,nofollow">
  <meta name="referrer" content="no-referrer">
{% raw %}
  <style>
${VOTE_CSS}
  </style>
{% endraw %}
</head>
<body>
  <div class="pvb-vote-page">
    <header class="pvb-top-bar">
      <p class="pvb-shop-name">${escapeForLiquid(shopName)}</p>
    </header>
    <div class="pvb-error-page">
      <h1 class="pvb-error-headline">${escapeForLiquid(headline)}</h1>
      <p class="pvb-error-body">${escapeForLiquid(body)}</p>
      <a href="${escapeForLiquid(shopUrl)}" class="pvb-btn-primary">Shop ${escapeForLiquid(shopName)}</a>
    </div>
  </div>
</body>
</html>`;
}

export const loader = async ({ request, params }) => {
  const { liquid, admin, session } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop") || "";
  const pathPrefix = url.searchParams.get("path_prefix") || "/apps/board";
  const splat = params["*"] || "";

  // Extract shop name from domain (remove .myshopify.com)
  const shopName = shop.replace(/\.myshopify\.com$/, "").replace(/-/g, " ");
  const shopUrl = `https://${shop}`;

  // Get settings
  const settings = await getSettings(shop);

  // Helper to return error page
  const errorPage = (headline, body) =>
    liquid(buildErrorPage({ headline, body, shopName, shopUrl }), {
      layout: false,
      headers: NO_STORE,
    });

  // Route: empty or root -> not found
  if (!splat || splat === "/") {
    log.info("proxy.vote_page", { shop, status: "not_found" });
    return errorPage("This link doesn't work", "Check the URL and try again.");
  }

  // Route: results/<ownerToken>
  if (splat.startsWith("results/")) {
    const ownerToken = splat.slice(8); // "results/".length = 8
    if (!ownerToken) {
      log.info("proxy.results_page", { shop, status: "not_found" });
      return errorPage("This link doesn't work", "Check the URL and try again.");
    }

    const board = await getBoardByOwnerToken(shop, ownerToken);
    if (!board) {
      log.info("proxy.results_page", { shop, status: "not_found" });
      return errorPage("This link doesn't work", "Check the URL and try again.");
    }

    // Check if feature is enabled
    if (!settings.enabled) {
      log.info("proxy.results_page", { shop, status: "disabled" });
      return errorPage("This board isn't available", "Check back later.");
    }

    // Check expiry
    if (board.expiresAt < new Date()) {
      const expiredHeadline = settings.copy.expiredHeadline || "This board has closed";
      const expiredBody = replacePlaceholders(
        settings.copy.expiredBody || "Ask {shopper} to share a new link.",
        { shopper: board.ownerFirstName, partner: board.partnerFirstName, count: 0 }
      );
      log.info("proxy.results_page", { shop, status: "expired" });
      return errorPage(expiredHeadline, expiredBody);
    }

    // Get votes for the board
    const votes = await getVotesForBoard(board.id);

    // Fetch live product data
    const variantGids = board.items.map((item) => item.variantId);
    let variants = new Map();
    if (admin) {
      try {
        variants = await fetchVariants(admin, variantGids);
      } catch (err) {
        log.error("proxy.results_page_variants", { code: err.code || "unknown" });
      }
    }

    // Build items array with product data and availability
    const items = board.items.map((item) => {
      const variant = variants.get(item.variantId);
      const productTitle = variant?.productTitle || "Item";
      const variantTitle =
        variant?.variantTitle && variant.variantTitle !== "Default Title"
          ? variant.variantTitle
          : "";
      const title = variantTitle
        ? `${productTitle} - ${variantTitle}`
        : productTitle;
      const priceNum = parseFloat(variant?.price || 0);
      const price = variant ? formatPrice(variant.price, variant.currencyCode) : "";
      const priceCents = Math.round(priceNum * 100);
      const image = variant?.imageUrl || "";
      const handle = variant?.handle || "";
      const productUrl = handle ? `${shopUrl}/products/${handle}` : shopUrl;

      // Check eligibility: availableForSale AND product ACTIVE AND not gift card AND not excluded
      const eligibility = checkEligibility(variant, settings);
      const available = eligibility === null;

      // Extract numeric variant ID for cart API
      const variantId = parseInt(item.variantId.replace(/\D/g, ""), 10);

      return {
        id: item.id,
        variantId,
        title,
        variantTitle,
        price,
        priceCents,
        currencyCode: variant?.currencyCode || "USD",
        image,
        url: productUrl,
        available,
      };
    });

    // Log with vote breakdown
    const lovedCount = votes.filter((v) => v.verdict === "LOVE").length;
    const maybeCount = votes.filter((v) => v.verdict === "MAYBE").length;
    const passCount = votes.filter((v) => v.verdict === "PASS").length;
    log.info("proxy.results_page", {
      shop,
      status: board.status,
      loved: lovedCount,
      maybe: maybeCount,
      pass: passCount,
    });

    // Record results_opened event (every view)
    await recordEvent(shop, "results_opened", {
      boardId: board.id,
      meta: { status: board.status },
    });

    return liquid(
      buildResultsPage({
        board,
        items,
        votes,
        settings,
        shopName,
        shopUrl,
        proxyPath: pathPrefix,
      }),
      { layout: false, headers: NO_STORE }
    );
  }

  // Route: <shareToken> -> vote page
  const shareToken = splat;

  // Validate token format (basic sanity check - cuid is 25 chars)
  if (shareToken.length < 20 || shareToken.length > 40 || /[^a-zA-Z0-9_-]/.test(shareToken)) {
    log.info("proxy.vote_page", { shop, status: "not_found" });
    return errorPage("This link doesn't work", "Check the URL and try again.");
  }

  const board = await getBoardByShareToken(shop, shareToken);
  if (!board) {
    log.info("proxy.vote_page", { shop, status: "not_found" });
    return errorPage("This link doesn't work", "Check the URL and try again.");
  }

  // Check if feature is enabled
  if (!settings.enabled) {
    log.info("proxy.vote_page", { shop, status: "disabled" });
    return errorPage("This board isn't available", "Check back later.");
  }

  // Check expiry
  if (board.expiresAt < new Date()) {
    const expiredHeadline = settings.copy.expiredHeadline || "This board has closed";
    const expiredBody = replacePlaceholders(
      settings.copy.expiredBody || "Ask {shopper} to share a new link.",
      { shopper: board.ownerFirstName, partner: board.partnerFirstName, count: board.items.length }
    );
    log.info("proxy.vote_page", { shop, status: "expired" });
    return errorPage(expiredHeadline, expiredBody);
  }

  // Set partnerOpenedAt if null (conditional update)
  const wasFirstOpen = await setPartnerOpenedAt(board.id);

  // Record partner_opened event only on first open
  if (wasFirstOpen) {
    await recordEvent(shop, "partner_opened", { boardId: board.id });
  }

  // Get existing votes
  const votes = await getVotesForBoard(board.id);

  // If board is already VOTED, show done screen via initial data
  // (The JS will detect all items voted and show the done screen)

  // Fetch live product data
  const variantGids = board.items.map((item) => item.variantId);
  let variants = new Map();
  if (admin) {
    try {
      variants = await fetchVariants(admin, variantGids);
    } catch (err) {
      log.error("proxy.vote_page_variants", { code: err.code || "unknown" });
      // Continue with empty variants - items will show without product data
    }
  }

  // Build items array with product data
  const items = board.items.map((item) => {
    const variant = variants.get(item.variantId);
    const title = variant
      ? variant.variantTitle && variant.variantTitle !== "Default Title"
        ? `${variant.productTitle} - ${variant.variantTitle}`
        : variant.productTitle
      : "Item";
    const price = variant ? formatPrice(variant.price, variant.currencyCode) : "";
    const image = variant?.imageUrl || "";
    const handle = variant?.handle || "";
    const productUrl = handle ? `${shopUrl}/products/${handle}` : shopUrl;

    return {
      id: item.id,
      title: title || "Item",
      price,
      image,
      url: productUrl,
      available: variant?.availableForSale ?? true,
    };
  });

  // Build storage key (hash of token)
  const storageKey = hashToken(shareToken);

  const html = buildVotePage({
    board,
    items,
    votes,
    copy: settings.copy,
    shopName,
    shopUrl,
    proxyPath: pathPrefix,
    storageKey,
  });

  log.info("proxy.vote_page", { shop, status: board.status });

  return liquid(html, { layout: false, headers: NO_STORE });
};
