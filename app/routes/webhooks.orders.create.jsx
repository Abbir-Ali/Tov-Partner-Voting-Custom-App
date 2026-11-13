/**
 * Orders webhook: orders/create
 * Records order_from_board event when cart has _pvb_board attribute.
 * Idempotent via unique (shop, orderId) constraint.
 * Stores only order ID, subtotal, currency, and board ID. No customer data.
 */
import { authenticate } from "../shopify.server.js";
import { recordEvent } from "../models/events.server.js";
import { log } from "../utils/log.server.js";

export const action = async ({ request }) => {
  const { payload, shop } = await authenticate.webhook(request);

  // Look for _pvb_board in note_attributes (cart attributes)
  const noteAttributes = payload.note_attributes || [];
  const pvbAttr = noteAttributes.find((attr) => attr.name === "_pvb_board");

  if (!pvbAttr || !pvbAttr.value) {
    // Not a PVB order, acknowledge and return
    return new Response(null, { status: 200 });
  }

  const boardId = pvbAttr.value;
  const orderId = payload.admin_graphql_api_id; // GID format

  // Convert subtotal to cents (current_subtotal_price is a string like "123.45")
  const subtotal = parseFloat(payload.current_subtotal_price || "0");
  const valueCents = Math.round(subtotal * 100);
  const currencyCode = payload.currency || "USD";

  const result = await recordEvent(shop, "order_from_board", {
    boardId,
    orderId,
    valueCents,
    currencyCode,
  });

  if (result.ok) {
    log.info("order.attributed", { shop, boardId });
  }

  return new Response(null, { status: 200 });
};
