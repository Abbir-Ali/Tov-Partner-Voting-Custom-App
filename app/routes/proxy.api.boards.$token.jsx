import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";
import { getBoardByShareToken } from "../models/board.server.js";
import { fetchVariants } from "../services/products.server.js";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

// Loader only — GET /apps/board/api/boards/:token (via App Proxy → /proxy/api/boards/:token)
export const loader = async ({ request, params }) => {
  // Authenticate the Shopify-signed proxy request
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) {
    return json({ error: { code: "setup" } }, 503);
  }

  const url  = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  // Check feature flag
  const settings = await getSettings(shop);
  if (!settings.enabled) {
    return json({ error: { code: "disabled" } }, 404);
  }

  // Look up the board — always filter by shop AND token
  const board = await getBoardByShareToken(shop, params.token);
  if (!board) {
    return json({ error: { code: "not_found" } }, 404);
  }

  // Check expiry
  const now = new Date();
  if (board.expiresAt < now) {
    // ownerFirstName is safe to return — it's the name the shopper chose to share
    return json(
      { error: { code: "expired" }, ownerFirstName: board.ownerFirstName },
      410
    );
  }

  // Fetch variant details for all items
  const variantGids = board.items.map((item) => item.variantId);
  const variants    = await fetchVariants(admin, variantGids);

  // Build response items — NEVER include ownerEmail, customerId,
  // creatorKey, ownerToken, or any internal DB ids other than itemId.
  const items = board.items.map((item) => {
    const v = variants.get(item.variantId);
    return {
      itemId:          item.id,
      position:        item.position,
      productTitle:    v?.productTitle  ?? null,
      variantTitle:    v?.variantTitle  ?? null,
      handle:          v?.handle        ?? null,
      price:           v?.price         ?? null,
      currencyCode:    v?.currencyCode  ?? null,
      imageUrl:        v?.imageUrl      ?? null,
      imageAlt:        v?.imageAlt      ?? null,
      availableForSale: v?.availableForSale ?? false,
    };
  });

  console.log(`[board.fetch] shop=${shop} items=${items.length}`);

  return json({
    name:            board.name,
    ownerFirstName:  board.ownerFirstName,
    partnerFirstName: board.partnerFirstName,
    note:            board.note,
    status:          board.status,
    expiresAt:       board.expiresAt,
    items,
  });
};
