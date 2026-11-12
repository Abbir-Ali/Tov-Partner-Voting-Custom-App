import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";
import {
  validateCreateInput,
  createBoard,
  countSharesToday,
} from "../models/board.server.js";
import { fetchVariants, checkEligibility } from "../services/products.server.js";
import { creatorKey } from "../utils/tokens.server.js";
import { log } from "../utils/log.server.js";

const NO_STORE       = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 20 * 1024;

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, ...extraHeaders },
  });
}

// Action only — POST /apps/board/api/boards (via App Proxy → /proxy/api/boards)
export const action = async ({ request }) => {
  // Reject non-POST
  if (request.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405, { Allow: "POST" });
  }

  // Authenticate the Shopify-signed proxy request
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) {
    return json({ error: { code: "setup" } }, 503);
  }

  const url        = new URL(request.url);
  const shop       = url.searchParams.get("shop") ?? "";
  const pathPrefix = url.searchParams.get("path_prefix") ?? "";
  const customerId = url.searchParams.get("logged_in_customer_id") || null;
  const isLoggedIn = !!customerId;

  // Check feature flag
  const settings = await getSettings(shop);
  if (!settings.enabled) {
    return json({ error: { code: "disabled" } }, 404);
  }

  // Content-type guard
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json(
      { error: { code: "invalid", message: "Content-Type must be application/json." } },
      400
    );
  }

  // Read body as text, check actual UTF-8 byte length, then parse
  let rawText;
  try {
    rawText = await request.text();
  } catch {
    return json({ error: { code: "invalid", message: "Could not read request body." } }, 400);
  }
  if (new TextEncoder().encode(rawText).length > MAX_BODY_BYTES) {
    return json({ error: { code: "invalid", message: "Request body is too large." } }, 400);
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    return json({ error: { code: "invalid", message: "Could not parse JSON body." } }, 400);
  }

  // 1. Validate fields (email required for guests even when notifications off)
  const { data, errors } = validateCreateInput(body, settings, { isLoggedIn });
  if (Object.keys(errors).length > 0) {
    log.error("board.create_rejected", { shop, code: "invalid" });
    return json({ error: { code: "invalid", fields: errors } }, 400);
  }

  // 2. Daily share limit — DB only, before hitting the Admin API
  // Creator: namespaced by kind so customer IDs and emails never collide
  const ck = isLoggedIn
    ? creatorKey(shop, "customer", customerId)
    : creatorKey(shop, "email",    data.ownerEmail);
  data.creatorKey = ck;

  const count = await countSharesToday(shop, ck);
  if (count >= settings.maxSharesPerDay) {
    log.error("board.create_rejected", { shop, code: "limit" });
    return json(
      {
        error: {
          code:    "limit",
          message: "You've shared the most boards allowed today. Try again tomorrow.",
        },
      },
      429
    );
  }

  // 3. Fetch variant details from the Admin API
  const variantGids = data.items.map((i) => i.variantId);
  let variants;
  try {
    variants = await fetchVariants(admin, variantGids);
  } catch (err) {
    // Log only the sanitized code, never err.message (may leak stack/PII).
    log.error("board.create_upstream", { code: err.code ?? "unknown" });
    return json(
      {
        error: {
          code:    "upstream",
          message: "We couldn't check those pieces right now. Try again in a moment.",
        },
      },
      502
    );
  }

  // 4. Eligibility check
  const ineligible = [];
  for (const { variantId } of data.items) {
    const reason = checkEligibility(variants.get(variantId), settings);
    if (reason) ineligible.push({ variantId, reason });
  }
  if (ineligible.length > 0) {
    log.error("board.create_rejected", { shop, code: "ineligible" });
    return json({ error: { code: "ineligible", items: ineligible } }, 400);
  }

  // 5. Enrich items with productId and position
  data.items = data.items.map((item, i) => ({
    variantId: item.variantId,
    productId: variants.get(item.variantId).productId,
    position:  i,
  }));

  // 6. Create the board
  const { board, shareToken, ownerToken } = await createBoard({
    shop, data, customerId, settings,
  });

  log.info("board.created", { shop, items: data.items.length });

  return json(
    {
      shareUrl:   `https://${shop}${pathPrefix}/${shareToken}`,
      resultsUrl: `https://${shop}${pathPrefix}/results/${ownerToken}`,
      expiresAt:  board.expiresAt,
    },
    201
  );
};
