/**
 * Sidekick API endpoint for tool calls.
 * PRIVACY RULE: Customer names, board order counts and revenue only via
 * top_board_customers, only when the merchant asks. Never emails, phones,
 * addresses, notes or partner names.
 */
import { authenticate } from "../shopify.server.js";
import { executeTool } from "../services/sidekick.server.js";

// Valid tool names
const VALID_TOOLS = new Set([
  "board_performance",
  "top_shared_products",
  "product_partner_feedback",
  "orders_from_boards",
  "shares_by_channel",
  "notification_health",
  "top_board_customers",
]);

// Valid days values
const VALID_DAYS = new Set([7, 14, 30, 60]);

export const loader = async ({ request, params }) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const shop = session.shop;
  const tool = params.tool;

  // Validate tool name
  if (!VALID_TOOLS.has(tool)) {
    return cors(Response.json({ error: "Unknown tool" }, { status: 404 }));
  }

  // Parse and validate query params
  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days");
  const rawLimit = url.searchParams.get("limit");
  const productTitle = url.searchParams.get("product_title");
  const productId = url.searchParams.get("product_id");
  const repeatOnly = url.searchParams.get("repeat_only");

  // Validate days
  let days = 30;
  if (rawDays) {
    const n = parseInt(rawDays, 10);
    if (!VALID_DAYS.has(n)) {
      return cors(Response.json({ error: "days must be 7, 14, 30, or 60" }, { status: 400 }));
    }
    days = n;
  }

  // Validate limit
  let limit = 10;
  if (rawLimit) {
    const n = parseInt(rawLimit, 10);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return cors(Response.json({ error: "limit must be 1-10" }, { status: 400 }));
    }
    limit = n;
  }

  // Validate product text length
  if (productTitle && productTitle.length > 100) {
    return cors(Response.json({ error: "product_title too long" }, { status: 400 }));
  }

  // Build params
  const toolParams = { days, limit };
  if (productTitle) toolParams.product_title = productTitle;
  if (productId) toolParams.product_id = productId;
  if (repeatOnly === "true") toolParams.repeat_only = true;

  // Execute
  const data = await executeTool(shop, admin, tool, toolParams);

  if (data === null) {
    return cors(Response.json({ error: "Unknown tool" }, { status: 404 }));
  }

  return cors(Response.json(data));
};

// Handle OPTIONS preflight
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "https://extensions.shopifycdn.com",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return new Response(null, { status: 405 });
};
