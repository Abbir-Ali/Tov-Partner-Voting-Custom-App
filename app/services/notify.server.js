/**
 * Klaviyo notification service for "voting done" emails.
 * Sends events to Klaviyo; the email is built in Klaviyo flows.
 * Updated for group voting: notifications are per voter.
 */

import db from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import { decrypt } from "../utils/crypto.server.js";
import { log } from "../utils/log.server.js";
import { fetchVariants } from "./products.server.js";
import { recordEvent } from "../models/events.server.js";

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2026-10-15";
const METRIC_NAME = "PVB Voting Completed";
const NOTIFY_TIMEOUT_MS = 8000;
const MAX_LOVED_ITEMS = 6;
const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_HOURS = 24;

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
        voter_first_name: "Alex",
        // Keep partner_first_name for backward compatibility with existing flows
        partner_first_name: "Alex",
        loved_count: 2,
        maybe_count: 1,
        pass_count: 1,
        total: 4,
        voters_done: 2,
        voters_invited: 3,
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
 * Sends the "voting completed" event to Klaviyo for a voter.
 * Called when a voter finishes voting on all items.
 * Skips silently if: notifications disabled, no key, no email, already notified.
 *
 * @param {string} voterId - The voter who completed
 * @param {string} boardId - The board ID
 * @param {string} shop - The shop domain
 */
export async function sendVotingCompleted(voterId, boardId, shop) {
  // Load voter with board, items, and this voter's votes
  const voter = await db.voter.findUnique({
    where: { id: voterId },
    include: {
      board: {
        include: {
          items: {
            orderBy: { position: "asc" },
          },
          _count: { select: { voters: true } },
        },
      },
      votes: true,
    },
  });

  if (!voter) {
    log.warn("notify.skipped", { voterId, reason: "voter_not_found" });
    return { ok: false, reason: "voter_not_found" };
  }

  const board = voter.board;

  // Already notified this voter?
  if (voter.notifiedAt) {
    log.info("notify.skipped", { shop, voterId, reason: "already_notified" });
    return { ok: false, reason: "already_notified" };
  }

  // No email to send to?
  if (!board.ownerEmail) {
    log.info("notify.skipped", { shop, voterId, reason: "no_email" });
    return { ok: false, reason: "no_email" };
  }

  // Load settings
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  // Notifications disabled?
  if (!settings?.notificationsEnabled) {
    log.info("notify.skipped", { shop, voterId, reason: "disabled" });
    return { ok: false, reason: "disabled" };
  }

  // No Klaviyo key?
  if (!settings.klaviyoKeyEncrypted) {
    log.info("notify.skipped", { shop, voterId, reason: "no_key" });
    return { ok: false, reason: "no_key" };
  }

  // Voter completed before Klaviyo was connected? Skip and mark.
  if (settings.klaviyoConnectedAt && voter.completedAt < settings.klaviyoConnectedAt) {
    if (voter.notifyErrorCode !== "skipped_old") {
      log.info("notify.skipped", { shop, voterId, reason: "before_connected" });
      await db.voter.update({
        where: { id: voterId },
        data: { notifyErrorCode: "skipped_old" },
      });
    }
    return { ok: false, reason: "before_connected" };
  }

  // Voter too old (over 24 hours)? Skip and mark.
  const retryCutoff = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
  if (voter.completedAt < retryCutoff) {
    if (voter.notifyErrorCode !== "skipped_old") {
      log.info("notify.skipped", { shop, voterId, reason: "too_old" });
      await db.voter.update({
        where: { id: voterId },
        data: { notifyErrorCode: "skipped_old" },
      });
    }
    return { ok: false, reason: "too_old" };
  }

  const apiKey = decrypt(settings.klaviyoKeyEncrypted);
  if (!apiKey) {
    log.warn("notify.skipped", { shop, voterId, reason: "decrypt_failed" });
    await db.voter.update({
      where: { id: voterId },
      data: { notifyAttempts: { increment: 1 }, notifyErrorCode: "decrypt_failed" },
    });
    return { ok: false, reason: "decrypt_failed" };
  }

  // Count votes by verdict for this voter
  const counts = { love: 0, maybe: 0, pass: 0 };
  const lovedItemIds = [];
  const votesByItem = new Map();

  for (const vote of voter.votes) {
    counts[vote.verdict.toLowerCase()]++;
    votesByItem.set(vote.boardItemId, vote.verdict);
    if (vote.verdict === "LOVE") {
      // Find the item to get variantId
      const item = board.items.find((i) => i.id === vote.boardItemId);
      if (item) lovedItemIds.push(item.variantId);
    }
  }

  // Get voter stats (how many have completed)
  const votersCompleted = await db.voter.count({
    where: { boardId, completedAt: { not: null } },
  });

  // Fetch product details for loved items
  let lovedItems = [];
  if (lovedItemIds.length > 0) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const variantMap = await fetchVariants(admin, lovedItemIds);

      for (const variantId of lovedItemIds.slice(0, MAX_LOVED_ITEMS)) {
        const v = variantMap.get(variantId);
        if (v) {
          const variantTitle = v.variantTitle === "Default Title" ? "" : (v.variantTitle || "");
          lovedItems.push({
            title: v.productTitle || "Product",
            variant_title: variantTitle,
            price: formatPrice(v.price, v.currencyCode),
            image_url: v.imageUrl || "",
            product_url: `https://${shop}/products/${v.handle}`,
          });
        }
      }
    } catch (err) {
      log.warn("notify.variant_fetch_failed", { shop, voterId, code: err.code || "unknown" });
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
      unique_id: `${voterId}_${voter.completedAt.getTime()}`, // Prevents duplicates on retry
      properties: {
        owner_first_name: board.ownerFirstName || "Friend",
        voter_first_name: voter.firstName,
        // Keep partner_first_name for backward compatibility with existing flows
        partner_first_name: voter.firstName,
        loved_count: counts.love,
        maybe_count: counts.maybe,
        pass_count: counts.pass,
        total: board.items.length,
        voters_done: votersCompleted,
        voters_invited: board._count.voters,
        results_url: resultsUrl,
        board_name: board.name,
        loved_items: lovedItems,
      },
    },
  };

  // Send to Klaviyo
  const result = await sendKlaviyoEvent(apiKey, event);

  if (result.ok) {
    await db.voter.update({
      where: { id: voterId },
      data: { notifiedAt: new Date(), notifyErrorCode: null },
    });
    log.info("notify.sent", { shop, voterId, boardId });
    await recordEvent(shop, "notify_sent", { boardId });
    return { ok: true };
  }

  // Failed: record attempt
  await db.voter.update({
    where: { id: voterId },
    data: {
      notifyAttempts: { increment: 1 },
      notifyErrorCode: result.code,
    },
  });
  log.warn("notify.failed", {
    shop,
    voterId,
    code: result.code,
    attempt: voter.notifyAttempts + 1,
  });
  return { ok: false, code: result.code };
}

/**
 * Retries pending notifications for a shop (voters that completed but weren't notified).
 * Called from admin Home loader for self-healing.
 * Only sends for voters finished after Klaviyo was connected and within 24 hours.
 */
export async function sendPendingNotifications(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.klaviyoConnectedAt) {
    return { attempted: 0, sent: 0 };
  }

  const retryCutoff = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
  // Use the later of: 24h ago or when Klaviyo was connected
  const effectiveCutoff = retryCutoff > settings.klaviyoConnectedAt
    ? retryCutoff
    : settings.klaviyoConnectedAt;

  const pending = await db.voter.findMany({
    where: {
      board: { shop },
      completedAt: { gte: effectiveCutoff },
      notifiedAt: null,
      notifyAttempts: { lt: MAX_ATTEMPTS },
      OR: [{ notifyErrorCode: null }, { notifyErrorCode: { not: "skipped_old" } }],
    },
    select: { id: true, boardId: true },
    take: 10, // Process max 10 per page load
  });

  let sent = 0;
  for (const voter of pending) {
    const result = await sendVotingCompleted(voter.id, voter.boardId, shop);
    if (result.ok) sent++;
  }

  return { attempted: pending.length, sent };
}

/**
 * Checks if there are failed notifications that need attention.
 */
export async function hasFailedNotifications(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.klaviyoConnectedAt) {
    return false;
  }

  const retryCutoff = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
  const effectiveCutoff = retryCutoff > settings.klaviyoConnectedAt
    ? retryCutoff
    : settings.klaviyoConnectedAt;

  const count = await db.voter.count({
    where: {
      board: { shop },
      completedAt: { gte: effectiveCutoff },
      notifiedAt: null,
      notifyAttempts: { gte: MAX_ATTEMPTS },
      OR: [{ notifyErrorCode: null }, { notifyErrorCode: { not: "skipped_old" } }],
    },
  });

  return count > 0;
}

/**
 * Returns notification stats for the admin dashboard.
 */
export async function getNotificationStats(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Sent in last 30 days (no klaviyoConnectedAt filter - these already succeeded)
  const sent = await db.voter.count({
    where: {
      board: { shop },
      notifiedAt: { gte: thirtyDaysAgo },
    },
  });

  // For pending/failed, only count voters after Klaviyo was connected and within 24h
  if (!settings?.klaviyoConnectedAt) {
    return { sent, pending: 0, failed: 0 };
  }

  const retryCutoff = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
  const effectiveCutoff = retryCutoff > settings.klaviyoConnectedAt
    ? retryCutoff
    : settings.klaviyoConnectedAt;

  const [pending, failed] = await Promise.all([
    // Pending (can still retry)
    db.voter.count({
      where: {
        board: { shop },
        completedAt: { gte: effectiveCutoff },
        notifiedAt: null,
        notifyAttempts: { lt: MAX_ATTEMPTS },
        OR: [{ notifyErrorCode: null }, { notifyErrorCode: { not: "skipped_old" } }],
      },
    }),
    // Failed (exhausted retries)
    db.voter.count({
      where: {
        board: { shop },
        completedAt: { gte: effectiveCutoff },
        notifiedAt: null,
        notifyAttempts: { gte: MAX_ATTEMPTS },
        OR: [{ notifyErrorCode: null }, { notifyErrorCode: { not: "skipped_old" } }],
      },
    }),
  ]);

  return { sent, pending, failed };
}

/**
 * Resets notifyAttempts for failed voters and retries them.
 * Called from the "Retry Failed Now" button on admin Home.
 * Only retries voters finished after Klaviyo was connected and within 24 hours.
 */
export async function retryFailedNotifications(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings?.klaviyoConnectedAt) {
    return { reset: 0, sent: 0 };
  }

  const retryCutoff = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
  const effectiveCutoff = retryCutoff > settings.klaviyoConnectedAt
    ? retryCutoff
    : settings.klaviyoConnectedAt;

  // Reset attempts for failed voters
  const resetResult = await db.voter.updateMany({
    where: {
      board: { shop },
      completedAt: { gte: effectiveCutoff },
      notifiedAt: null,
      notifyAttempts: { gte: MAX_ATTEMPTS },
      OR: [{ notifyErrorCode: null }, { notifyErrorCode: { not: "skipped_old" } }],
    },
    data: {
      notifyAttempts: 0,
      notifyErrorCode: null,
    },
  });

  // Now retry them
  const retryResult = await sendPendingNotifications(shop);

  log.info("notify.retry_failed", {
    shop,
    reset: resetResult.count,
    sent: retryResult.sent,
  });

  return { reset: resetResult.count, sent: retryResult.sent };
}
