/**
 * Public pixel events endpoint: POST /pixel/e
 * CORS-enabled for Web Pixel (can't use App Proxy).
 * Validates shop is installed and pixelKey matches.
 */
import db from "../db.server.js";
import { parseEventBody, processEvents } from "../services/events.server.js";
import { log } from "../utils/log.server.js";

// CORS headers for all responses
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Verify shop is installed and key matches.
 * @returns {Promise<boolean>}
 */
async function verifyShopKey(shop, key) {
  if (!shop || !key) return false;

  // Check for offline session (app installed)
  const session = await db.session.findFirst({
    where: { shop, isOnline: false },
    select: { id: true },
  });
  if (!session) return false;

  // Check pixelKey matches
  const settings = await db.shopSettings.findUnique({
    where: { shop },
    select: { pixelKey: true },
  });
  if (!settings?.pixelKey) return false;

  return settings.pixelKey === key;
}

// Handle OPTIONS preflight
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response(null, { status: 405, headers: CORS_HEADERS });
};

// Handle POST events
export const action = async ({ request }) => {
  // CORS preflight handled by loader, but also accept OPTIONS here
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: CORS_HEADERS });
  }

  // Parse body
  const parsed = await parseEventBody(request);
  if (!parsed.ok) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const body = parsed.body;

  // Extract shop and key from body
  const shop = typeof body.shop === "string" ? body.shop : null;
  const key = typeof body.key === "string" ? body.key : null;

  // Verify shop is installed and key matches
  const valid = await verifyShopKey(shop, key);
  if (!valid) {
    log.warn("events.pixel_auth_failed", { shop: shop || "unknown" });
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Accept single event or array; extract events data
  const events = Array.isArray(body.events)
    ? body.events
    : body.type
      ? [body]
      : [];

  await processEvents(shop, events);

  // Always respond 204 quickly
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};
