/**
 * Events ingest endpoint: POST /apps/board/api/e (via App Proxy).
 * Accepts client-side analytics events from results page (sendBeacon).
 * Hashes clientId server-side with APP_EVENT_SALT.
 */
import { authenticate } from "../shopify.server.js";
import { parseEventBody, processEvents } from "../services/events.server.js";
import { log } from "../utils/log.server.js";

// Action only — POST /apps/board/api/e
export const action = async ({ request }) => {
  // Reject non-POST
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  // Authenticate the Shopify-signed proxy request
  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop;
  if (!shop) {
    return new Response(null, { status: 204 });
  }

  // Parse body
  const parsed = await parseEventBody(request);
  if (!parsed.ok) {
    log.warn("events.dropped", { shop, reason: parsed.reason });
    return new Response(null, { status: 204 });
  }

  // Accept single event or array
  const events = Array.isArray(parsed.body) ? parsed.body : [parsed.body];
  await processEvents(shop, events);

  // Always respond 204 quickly
  return new Response(null, { status: 204 });
};

// Reject GET requests
export const loader = () => new Response(null, { status: 405 });
