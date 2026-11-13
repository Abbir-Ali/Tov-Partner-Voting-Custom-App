/**
 * Shared event processing logic.
 * Used by both proxy.api.e.jsx (App Proxy) and pixel.e.jsx (public CORS).
 */
import { createHash } from "crypto";
import {
  recordEvent,
  countRecentEvents,
  countRecentShopEvents,
  CLIENT_ALLOWED_TYPES,
} from "../models/events.server.js";
import { log } from "../utils/log.server.js";

export { CLIENT_ALLOWED_TYPES };

const MAX_BODY_BYTES = 2 * 1024; // 2 KB
const MAX_EVENTS_PER_REQUEST = 10;
const RATE_LIMIT_VISITOR = 120; // per visitorHash per shop per 10 min
const RATE_LIMIT_ANON = 300; // per shop per 10 min for anonymous events
const RATE_LIMIT_MINUTES = 10;

// Allowed channels for meta.channel
const ALLOWED_CHANNELS = new Set(["whatsapp", "email", "copy", "native"]);

// Log once per process if salt is missing
let saltWarningLogged = false;

/**
 * Hash clientId with shop and salt server-side.
 * Returns null if clientId or salt is missing.
 */
export function hashClientId(shop, clientId) {
  const salt = process.env.APP_EVENT_SALT;
  if (!salt) {
    if (!saltWarningLogged) {
      log.warn("events.no_salt", {});
      saltWarningLogged = true;
    }
    return null;
  }
  if (!clientId) return null;
  return createHash("sha256")
    .update(shop + clientId + salt)
    .digest("hex");
}

/**
 * Parse and validate request body.
 * @returns {{ ok: boolean, body?: object, reason?: string }}
 */
export async function parseEventBody(request) {
  let rawText;
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  if (new TextEncoder().encode(rawText).length > MAX_BODY_BYTES) {
    return { ok: false, reason: "body_too_large" };
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "parse_failed" };
  }

  return { ok: true, body };
}

/**
 * Process an array of events.
 * @returns {Promise<number>} Number of events recorded
 */
export async function processEvents(shop, events) {
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    log.warn("events.dropped", { shop, reason: "too_many_events" });
    return 0;
  }

  let recorded = 0;
  for (const evt of events) {
    // Validate type is in client allowlist
    if (!evt.type || !CLIENT_ALLOWED_TYPES.has(evt.type)) {
      continue; // Skip invalid types silently
    }

    // Extract clientId from request, hash server-side
    const clientId = typeof evt.clientId === "string" ? evt.clientId : null;
    const visitorHash = hashClientId(shop, clientId);

    // Extract other fields
    const boardId = typeof evt.boardId === "string" ? evt.boardId : null;
    const valueCents = typeof evt.valueCents === "number" ? evt.valueCents : null;
    const currencyCode = typeof evt.currencyCode === "string" ? evt.currencyCode : null;

    // Sanitize meta: only allow specific safe keys and values
    let meta = null;
    if (evt.meta && typeof evt.meta === "object") {
      const safeMeta = {};
      if (typeof evt.meta.channel === "string" && ALLOWED_CHANNELS.has(evt.meta.channel)) {
        safeMeta.channel = evt.meta.channel;
      }
      if (typeof evt.meta.added === "number") safeMeta.added = evt.meta.added;
      if (typeof evt.meta.failed === "number") safeMeta.failed = evt.meta.failed;
      if (typeof evt.meta.status === "string") safeMeta.status = evt.meta.status;
      if (Object.keys(safeMeta).length > 0) meta = safeMeta;
    }

    // Rate limit: per-visitor if hash exists, per-shop for anonymous
    if (visitorHash) {
      const recentCount = await countRecentEvents(shop, visitorHash, RATE_LIMIT_MINUTES);
      if (recentCount >= RATE_LIMIT_VISITOR) {
        log.warn("events.dropped", { shop, reason: "rate_limit_visitor" });
        continue;
      }
    } else {
      const anonCount = await countRecentShopEvents(shop, RATE_LIMIT_MINUTES);
      if (anonCount >= RATE_LIMIT_ANON) {
        log.warn("events.dropped", { shop, reason: "rate_limit_anon" });
        continue;
      }
    }

    // Record event
    const result = await recordEvent(shop, evt.type, {
      visitorHash,
      boardId,
      valueCents,
      currencyCode,
      meta,
    });

    if (result.ok) recorded++;
  }

  if (recorded > 0) {
    log.info("events.ingested", { shop, count: recorded });
  }

  return recorded;
}
