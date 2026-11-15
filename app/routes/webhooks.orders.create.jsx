/**
 * Orders webhook: orders/create
 * Records order_from_board event when cart has _pvb_board attribute.
 * Idempotent via unique (shop, orderId) constraint.
 * Stores order ID, subtotal, currency, board ID, and customer GID (never name/email).
 */
import { authenticate } from "../shopify.server.js";
import { recordEvent } from "../models/events.server.js";
import { getSettings } from "../models/settings.server.js";
import { addBuyerTag } from "../services/customer-tag.server.js";
import { log } from "../utils/log.server.js";

export const action = async ({ request }) => {
  const { payload, shop, admin } = await authenticate.webhook(request);

  // Look for _pvb_board in note_attributes (cart attributes)
  const noteAttributes = payload.note_attributes || [];
  const pvbAttr = noteAttributes.find((attr) => attr.name === "_pvb_board");

  if (!pvbAttr || !pvbAttr.value) {
    // Not a PVB order, acknowledge and return
    return new Response(null, { status: 200 });
  }

  const boardId = pvbAttr.value;
  const orderId = payload.admin_graphql_api_id; // GID format

  // Customer GID (null for guest checkouts)
  const customerId = payload.customer?.admin_graphql_api_id || null;

  // Convert subtotal to cents (current_subtotal_price is a string like "123.45")
  const subtotal = parseFloat(payload.current_subtotal_price || "0");
  const valueCents = Math.round(subtotal * 100);
  const currencyCode = payload.currency || "USD";

  // Order name like "#1001", truncate to 20 chars max
  const orderName = (payload.name || "").slice(0, 20);

  const result = await recordEvent(shop, "order_from_board", {
    boardId,
    orderId,
    customerId,
    valueCents,
    currencyCode,
    meta: { orderName },
  });

  if (result.ok) {
    log.info("order.attributed", { shop, boardId });
  }

  // Tag the customer if configured
  if (customerId) {
    const settings = await getSettings(shop);
    if (settings.buyerTag) {
      const tagResult = await addBuyerTag(admin, customerId, settings.buyerTag);
      if (!tagResult.ok) {
        log.warn("order.tag_failed", { shop, code: tagResult.code });
      }
    }
  }

  return new Response(null, { status: 200 });
};
