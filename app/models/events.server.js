/**
 * Analytics events model: recordEvent with allowlist, never throws.
 * No names, emails, notes, IPs or tokens in any column, including meta.
 */
import prisma from "../db.server.js";
import { log } from "../utils/log.server.js";

// Allowlist of valid event types
const ALLOWED_TYPES = new Set([
  // Server events
  "board_shared",
  "partner_opened",
  "vote_completed",
  "results_opened",
  "notify_sent",
  // Results page events (via sendBeacon)
  "results_add_loved",
  "results_add_maybe",
  // Storefront events (via Web Pixel)
  "button_impression",
  "button_save",
  "button_unsave",
  "drawer_open",
  "share_open",
  "share_channel",
  "drawer_add_all",
  // Order events (via webhook)
  "order_from_board",
]);

// Client-side types allowed from the ingest endpoint
export const CLIENT_ALLOWED_TYPES = new Set([
  "button_impression",
  "button_save",
  "button_unsave",
  "drawer_open",
  "share_open",
  "share_channel",
  "drawer_add_all",
  "results_add_loved",
  "results_add_maybe",
]);

/**
 * Record an analytics event. Never throws into the caller.
 * @param {string} shop - Shop domain
 * @param {string} type - Event type from allowlist
 * @param {object} fields - Event data (boardId, visitorHash, variant, valueCents, currencyCode, orderId, meta)
 * @returns {Promise<{ok: boolean, id?: string}>}
 */
export async function recordEvent(shop, type, fields = {}) {
  // Validate type
  if (!ALLOWED_TYPES.has(type)) {
    log.warn("events.record_failed", { shop, type, code: "invalid_type" });
    return { ok: false };
  }

  try {
    const event = await prisma.analyticsEvent.create({
      data: {
        shop,
        type,
        boardId: fields.boardId ?? null,
        visitorHash: fields.visitorHash ?? null,
        variant: fields.variant ?? null,
        valueCents: fields.valueCents ?? null,
        currencyCode: fields.currencyCode ?? null,
        orderId: fields.orderId ?? null,
        meta: fields.meta ?? null,
      },
    });
    return { ok: true, id: event.id };
  } catch (err) {
    // Handle unique constraint violation for orderId (idempotent)
    if (err.code === "P2002") {
      return { ok: true }; // Already recorded
    }
    log.error("events.record_failed", {
      shop,
      type,
      code: err.code ?? "unknown",
    });
    return { ok: false };
  }
}

/**
 * Count events for a visitor in the last N minutes (abuse guard).
 * @param {string} shop
 * @param {string} visitorHash
 * @param {number} minutes
 * @returns {Promise<number>}
 */
export async function countRecentEvents(shop, visitorHash, minutes = 10) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return prisma.analyticsEvent.count({
    where: {
      shop,
      visitorHash,
      createdAt: { gte: since },
    },
  });
}

// Anonymous client types (results page beacon, no clientId)
const ANONYMOUS_CLIENT_TYPES = ["results_add_loved", "results_add_maybe"];

/**
 * Count anonymous CLIENT events for a shop in the last N minutes (abuse guard).
 * Only counts results_add_loved and results_add_maybe, not server events.
 * @param {string} shop
 * @param {number} minutes
 * @returns {Promise<number>}
 */
export async function countRecentShopEvents(shop, minutes = 10) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return prisma.analyticsEvent.count({
    where: {
      shop,
      visitorHash: null,
      type: { in: ANONYMOUS_CLIENT_TYPES },
      createdAt: { gte: since },
    },
  });
}

/**
 * Get event counts by type for a shop in a time range.
 * @param {string} shop
 * @param {Date} since
 * @returns {Promise<Record<string, number>>}
 */
export async function getEventCounts(shop, since) {
  const results = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: {
      shop,
      createdAt: { gte: since },
    },
    _count: true,
  });
  const counts = {};
  for (const row of results) {
    counts[row.type] = row._count;
  }
  return counts;
}

/**
 * Get recent events for a shop.
 * @param {string} shop
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getRecentEvents(shop, limit = 10) {
  return prisma.analyticsEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      type: true,
      createdAt: true,
      boardId: true,
      valueCents: true,
    },
  });
}
