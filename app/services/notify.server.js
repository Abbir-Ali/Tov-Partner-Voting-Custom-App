/**
 * Klaviyo notification service for "voting done" emails.
 * Sends events to Klaviyo; the email is built in Klaviyo flows.
 */

import db from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import { decrypt } from "../utils/crypto.server.js";
import { log } from "../utils/log.server.js";
import { fetchVariants } from "./products.server.js";

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2025-01-15";
const METRIC_NAME = "PVB Voting Completed";
const NOTIFY_TIMEOUT_MS = 8000;
const MAX_LOVED_ITEMS = 6;
const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_DAYS = 7;

/**
 * Formats a price as "$1,234.00" for the given currency.
 */
function formatPrice(amount, currency) {
  if (amount == null) return "";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(num);
}

/**
 * Sends a Klaviyo event via their Create Event API.
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
async function sendKlaviyoEvent(apiKey, event) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

  try {
    const res = await fetch(`${KLAVIYO_API_BASE}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify({ data: event }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 202) {
      return { ok: true };
    }
    return { ok: false, code: String(res.status) };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: err.code || "network" };
  }
}

/**
 * Validates a Klaviyo private key by calling GET /accounts.
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export async function validateKlaviyoKey(apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

  try {
    const res = await fetch(`${KLAVIYO_API_BASE}/accounts`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 200) {
      return { ok: true };
    }
    return { ok: false, code: String(res.status) };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { ok: false, code: "timeout" };
    }
    return { ok: false, code: err.code || "network" };
  }
}

/**
 * Sends a test event to Klaviyo with sample data.
 */
export async function sendTestEvent(shop, email) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.klaviyoKeyEncrypted) {
    return { ok: false, code: "no_key" };
  }

  const apiKey = decrypt(settings.klaviyoKeyEncrypted);
  if (!apiKey) {
    return { ok: false, code: "decrypt_failed" };
  }

  // Sample data for testing the flow
  const storeUrl = `https://${shop}`;
  const event = {
    type: "event",
    attributes: {
      metric: { data: { type: "metric", attributes: { name: METRIC_NAME } } },
      profile: {
        data: {
          type: "profile",
          attributes: {
            email,
            first_name: "Test",
          },
        },
      },
      unique_id: `test_${Date.now()}`,
      properties: {
        owner_first_name: "Test",
        partner_first_name: "Alex",
        loved_count: 2,
        maybe_count: 1,
        pass_count: 1,
        total: 4,
        results_url: storeUrl,
        board_name: "Living Room Ideas",
        loved_items: [
          {
            title: "Sample Sofa",
            variant_title: "Gray / Large",
            price: "$1,299.00",
            image_url: "",
            product_url: storeUrl,
          },
          {
            title: "Accent Chair",
            variant_title: "Navy",
            price: "$499.00",
            image_url: "",
            product_url: storeUrl,
          },
        ],
      },
    },
  };

  const result = await sendKlaviyoEvent(apiKey, event);
  log.info("klaviyo.test_sent", { shop, ok: result.ok });
  return result;
}

/**
 * Sends the "voting completed" event to Klaviyo for a board.
 * Skips silently if: notifications disabled, no key, no email, already notified.
 */
export async function sendVotingCompleted(boardId) {
  // Load board with items and votes
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: {
      items: {
        include: { votes: true },
        orderBy: { position: "asc" },
      },
    },
  });

  if (!board) {
    log.warn("notify.skipped", { boardId, reason: "not_found" });
    return { ok: false, reason: "not_found" };
  }

  const shop = board.shop;

  // Already notified?
  if (board.notifiedAt) {
    log.info("notify.skipped", { shop, boardId, reason: "already_notified" });
    return { ok: false, reason: "already_notified" };
  }

  // No email to send to?
  if (!board.ownerEmail) {
    log.info("notify.skipped", { shop, boardId, reason: "no_email" });
    return { ok: false, reason: "no_email" };
  }

  // Load settings
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  // Notifications disabled?
  if (!settings?.notificationsEnabled) {
    log.info("notify.skipped", { shop, boardId, reason: "disabled" });
    return { ok: false, reason: "disabled" };
  }

  // No Klaviyo key?
  if (!settings.klaviyoKeyEncrypted) {
    log.info("notify.skipped", { shop, boardId, reason: "no_key" });
    return { ok: false, reason: "no_key" };
  }

  const apiKey = decrypt(settings.klaviyoKeyEncrypted);
  if (!apiKey) {
    log.warn("notify.skipped", { shop, boardId, reason: "decrypt_failed" });
    await db.board.update({
      where: { id: boardId },
      data: { notifyAttempts: { increment: 1 }, notifyErrorCode: "decrypt_failed" },
    });
    return { ok: false, reason: "decrypt_failed" };
  }

  // Count votes by verdict
  const counts = { love: 0, maybe: 0, pass: 0 };
  const lovedItemIds = [];

  for (const item of board.items) {
    const vote = item.votes[0];
    if (vote) {
      counts[vote.verdict.toLowerCase()]++;
      if (vote.verdict === "LOVE") {
        lovedItemIds.push(item.variantId);
      }
    }
  }

  // Fetch product details for loved items
  let lovedItems = [];
  if (lovedItemIds.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const variantMap = await fetchVariants(admin, lovedItemIds);

      for (const variantId of lovedItemIds.slice(0, MAX_LOVED_ITEMS)) {
        const v = variantMap.get(variantId);
        if (v) {
          lovedItems.push({
            title: v.productTitle || "Product",
            variant_title: v.variantTitle || "",
            price: formatPrice(v.price, v.currencyCode),
            image_url: v.imageUrl || "",
            product_url: `https://${shop}/products/${v.handle}`,
          });
        }
      }
    } catch (err) {
      // Non-fatal: proceed without product details
      log.warn("notify.variant_fetch_failed", { shop, boardId, code: err.code || "unknown" });
    }
  }

  // Build the results URL
  const resultsUrl = `https://${shop}/apps/board/results/${board.ownerToken}`;

  // Build the event
  const event = {
    type: "event",
    attributes: {
      metric: { data: { type: "metric", attributes: { name: METRIC_NAME } } },
      profile: {
        data: {
          type: "profile",
          attributes: {
            email: board.ownerEmail,
            first_name: board.ownerFirstName || undefined,
          },
        },
      },
      unique_id: board.id, // Prevents duplicates on retry
      properties: {
        owner_first_name: board.ownerFirstName || "Friend",
        partner_first_name: board.partnerFirstName || "Your partner",
        loved_count: counts.love,
        maybe_count: counts.maybe,
        pass_count: counts.pass,
        total: board.items.length,
        results_url: resultsUrl,
        board_name: board.name,
        loved_items: lovedItems,
      },
    },
  };

  // Send to Klaviyo
  const result = await sendKlaviyoEvent(apiKey, event);

  if (result.ok) {
    await db.board.update({
      where: { id: boardId },
      data: { notifiedAt: new Date(), notifyErrorCode: null },
    });
    log.info("notify.sent", { shop, boardId });
    return { ok: true };
  }

  // Failed: record attempt
  await db.board.update({
    where: { id: boardId },
    data: {
      notifyAttempts: { increment: 1 },
      notifyErrorCode: result.code,
    },
  });
  log.warn("notify.failed", {
    shop,
    boardId,
    code: result.code,
    attempt: board.notifyAttempts + 1,
  });
  return { ok: false, code: result.code };
}

/**
 * Retries pending notifications for a shop (boards that completed but weren't notified).
 * Called from admin Home loader for self-healing.
 */
export async function sendPendingNotifications(shop) {
  const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const pending = await db.board.findMany({
    where: {
      shop,
      status: "VOTED",
      votingCompletedAt: { gte: cutoff },
      notifiedAt: null,
      notifyAttempts: { lt: MAX_ATTEMPTS },
    },
    select: { id: true },
    take: 10, // Process max 10 per page load
  });

  let sent = 0;
  for (const board of pending) {
    const result = await sendVotingCompleted(board.id);
    if (result.ok) sent++;
  }

  return { attempted: pending.length, sent };
}

/**
 * Checks if there are failed notifications that need attention.
 */
export async function hasFailedNotifications(shop) {
  const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const count = await db.board.count({
    where: {
      shop,
      status: "VOTED",
      votingCompletedAt: { gte: cutoff },
      notifiedAt: null,
      notifyAttempts: { gte: MAX_ATTEMPTS },
    },
  });

  return count > 0;
}
