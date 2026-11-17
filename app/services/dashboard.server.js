/**
 * Dashboard data queries: read-only aggregates for the admin Home.
 * All queries scoped by shop.
 */
import prisma from "../db.server.js";
import { getNotificationStats } from "./notify.server.js";
import { log } from "../utils/log.server.js";

// Valid ranges in days
const VALID_RANGES = new Set([7, 14, 30, 60]);
const DEFAULT_RANGE = 30;

/**
 * Parse and validate the days param. Falls back to 30.
 * @param {string|number|null} param
 * @returns {number}
 */
export function parseRange(param) {
  const n = parseInt(param, 10);
  return VALID_RANGES.has(n) ? n : DEFAULT_RANGE;
}

/**
 * Get date range boundaries.
 * @param {number} days
 * @returns {{ since: Date, previousSince: Date }}
 */
function getDateRange(days) {
  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60 * 1000);
  const previousSince = new Date(now - 2 * days * 24 * 60 * 60 * 1000);
  return { since, previousSince };
}

/**
 * Revenue card data: sum of order_from_board valueCents in range.
 * @param {string} shop
 * @param {number} days
 */
async function getRevenueData(shop, days) {
  const { since, previousSince } = getDateRange(days);

  // Current period
  const current = await prisma.analyticsEvent.aggregate({
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: since },
    },
    _sum: { valueCents: true },
    _count: true,
  });

  // Previous period (same length, before current)
  const previous = await prisma.analyticsEvent.aggregate({
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: previousSince, lt: since },
    },
    _sum: { valueCents: true },
  });

  // Get currency from most recent order
  const latestOrder = await prisma.analyticsEvent.findFirst({
    where: { shop, type: "order_from_board", currencyCode: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { currencyCode: true },
  });

  // Check if multiple currencies exist
  const currencies = await prisma.analyticsEvent.groupBy({
    by: ["currencyCode"],
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: since },
      currencyCode: { not: null },
    },
  });

  return {
    valueCents: current._sum.valueCents || 0,
    orderCount: current._count,
    previousValueCents: previous._sum.valueCents || 0,
    currencyCode: latestOrder?.currencyCode || "USD",
    hasMultipleCurrencies: currencies.length > 1,
  };
}

/**
 * Daily revenue for chart (cumulative, zero-filled for every day in range).
 * Uses UTC days for consistency.
 * @param {string} shop
 * @param {number} days
 */
async function getDailyRevenue(shop, days) {
  const { since } = getDateRange(days);

  const orders = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: since },
    },
    select: {
      valueCents: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by UTC date string
  const byDate = new Map();
  for (const o of orders) {
    const dateKey = o.createdAt.toISOString().slice(0, 10);
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + (o.valueCents || 0));
  }

  // Build zero-filled cumulative array for every day in range (days+1 buckets to match since)
  const result = [];
  let cumulative = 0;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().slice(0, 10);
    cumulative += byDate.get(dateKey) || 0;
    result.push({ date: dateKey, cents: cumulative });
  }

  return result;
}

/**
 * KPI: boards shared in range.
 * @param {string} shop
 * @param {number} days
 */
async function getBoardsShared(shop, days) {
  const { since } = getDateRange(days);
  return prisma.board.count({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
  });
}

/**
 * KPI: vote rate = voters done / voters invited.
 * Counts across boards shared in range with SHARED or VOTED status.
 * @param {string} shop
 * @param {number} days
 */
async function getVoteRate(shop, days) {
  const { since } = getDateRange(days);

  // Get boards in range with their voter counts
  const boards = await prisma.board.findMany({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
    select: {
      voters: {
        select: { completedAt: true },
      },
    },
  });

  let invited = 0;
  let done = 0;
  for (const b of boards) {
    invited += b.voters.length;
    done += b.voters.filter((v) => v.completedAt).length;
  }

  return { voted: done, total: invited };
}

/**
 * Funnel data: mixes event counts and board/voter table counts.
 * Shared = boards shared in range.
 * Opened = boards with at least one voter.openedAt.
 * Voted = boards with at least one voter.completedAt.
 * Button seen, Saved, Added to cart, Ordered from events.
 * @param {string} shop
 * @param {number} days
 */
async function getFunnelData(shop, days) {
  const { since } = getDateRange(days);

  // Event-based counts
  const impressionVisitors = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "button_impression",
      createdAt: { gte: since },
      visitorHash: { not: null },
    },
    distinct: ["visitorHash"],
    select: { visitorHash: true },
  });

  const eventCounts = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: {
      shop,
      createdAt: { gte: since },
      type: { in: ["button_save", "results_add_loved", "order_from_board"] },
    },
    _count: true,
  });

  const countMap = {};
  for (const row of eventCounts) {
    countMap[row.type] = row._count;
  }

  // Board-based counts with voter data
  const boards = await prisma.board.findMany({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
    select: {
      voters: {
        select: { openedAt: true, completedAt: true },
      },
    },
  });

  const shared = boards.length;
  let opened = 0;
  let votingDone = 0;
  for (const b of boards) {
    if (b.voters.some((v) => v.openedAt)) opened++;
    if (b.voters.some((v) => v.completedAt)) votingDone++;
  }

  return {
    buttonSeen: impressionVisitors.length,
    saved: countMap["button_save"] || 0,
    shared,
    opened,
    votingDone,
    addedToCart: countMap["results_add_loved"] || 0,
    ordered: countMap["order_from_board"] || 0,
  };
}

/**
 * Get the date of the shop's first analytics event.
 * @param {string} shop
 * @returns {Promise<Date|null>}
 */
async function getFirstEventDate(shop) {
  const first = await prisma.analyticsEvent.findFirst({
    where: { shop },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return first?.createdAt || null;
}

/**
 * Latest orders from boards.
 * Batches board data fetch into one query.
 * @param {string} shop
 * @param {number} days
 * @param {number} limit
 */
async function getLatestOrders(shop, days, limit = 10) {
  const { since } = getDateRange(days);

  const orders = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      orderId: true,
      boardId: true,
      valueCents: true,
      currencyCode: true,
      createdAt: true,
      meta: true,
    },
  });

  // Batch fetch all boards for these orders
  const boardIds = orders.map((o) => o.boardId).filter(Boolean);
  const boards = boardIds.length
    ? await prisma.board.findMany({
        where: { id: { in: boardIds } },
        select: {
          id: true,
          items: { select: { votes: { select: { verdict: true } } } },
        },
      })
    : [];
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  const result = [];
  for (const o of orders) {
    let itemCount = 0;
    let lovedCount = 0;

    const board = o.boardId ? boardMap.get(o.boardId) : null;
    if (board) {
      itemCount = board.items.length;
      lovedCount = board.items.filter(
        (i) => i.votes[0]?.verdict === "LOVE"
      ).length;
    }

    // Extract order name from meta, or fallback
    const orderName = o.meta?.orderName || "Order";

    // Extract numeric ID from GID for admin link
    let numericOrderId = null;
    if (o.orderId) {
      const match = o.orderId.match(/Order\/(\d+)$/);
      if (match) numericOrderId = match[1];
    }

    result.push({
      orderName,
      numericOrderId,
      valueCents: o.valueCents,
      currencyCode: o.currencyCode || "USD",
      createdAt: o.createdAt,
      itemCount,
      lovedCount,
    });
  }

  return result;
}

/**
 * Top shared products by DISTINCT board count (not item count).
 * A board with two variants of the same product counts once.
 * @param {string} shop
 * @param {number} days
 * @param {number} limit
 */
async function getTopSharedProducts(shop, days, limit = 6) {
  const { since } = getDateRange(days);

  // Get boards shared in range
  const boards = await prisma.board.findMany({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
    select: { id: true },
  });

  if (boards.length === 0) return [];

  const boardIds = boards.map((b) => b.id);

  // Get all items, then count distinct boards per product in JS
  const items = await prisma.boardItem.findMany({
    where: { boardId: { in: boardIds } },
    select: { boardId: true, productId: true },
  });

  // Dedupe: count distinct boards per product
  const productBoards = new Map();
  for (const item of items) {
    const key = item.productId;
    if (!productBoards.has(key)) {
      productBoards.set(key, new Set());
    }
    productBoards.get(key).add(item.boardId);
  }

  // Sort by board count descending
  const sorted = Array.from(productBoards.entries())
    .map(([productId, boardSet]) => ({ productId, count: boardSet.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return sorted.map((p) => ({ ...p, title: null }));
}

/**
 * Partner feedback per product: votes breakdown.
 * Counts ALL voters' votes per product (not just first vote per item).
 * @param {string} shop
 * @param {number} days
 * @param {number} minVotes
 * @param {number} limit
 */
async function getProductFeedback(shop, days, minVotes = 5, limit = 6) {
  const { since } = getDateRange(days);

  // Get boards in range
  const boards = await prisma.board.findMany({
    where: {
      shop,
      sharedAt: { gte: since },
    },
    select: { id: true },
  });

  if (boards.length === 0) return [];

  const boardIds = boards.map((b) => b.id);

  // Get all items with ALL votes (not just first)
  const items = await prisma.boardItem.findMany({
    where: { boardId: { in: boardIds } },
    select: {
      productId: true,
      votes: { select: { verdict: true } },
    },
  });

  // Aggregate by product: count every vote from every voter
  const productMap = new Map();
  for (const item of items) {
    for (const vote of item.votes) {
      if (!productMap.has(item.productId)) {
        productMap.set(item.productId, { love: 0, maybe: 0, pass: 0 });
      }
      const p = productMap.get(item.productId);
      if (vote.verdict === "LOVE") p.love++;
      else if (vote.verdict === "MAYBE") p.maybe++;
      else if (vote.verdict === "PASS") p.pass++;
    }
  }

  // Filter and sort by total votes
  const result = [];
  for (const [productId, counts] of productMap) {
    const total = counts.love + counts.maybe + counts.pass;
    if (total >= minVotes) {
      const lovePercent = Math.round((counts.love / total) * 100);
      result.push({ productId, ...counts, total, lovePercent, title: null });
    }
  }

  result.sort((a, b) => b.total - a.total);
  return result.slice(0, limit);
}

/**
 * Shares by channel: first share_channel per board, grouped.
 * @param {string} shop
 * @param {number} days
 */
async function getSharesByChannel(shop, days) {
  const { since } = getDateRange(days);

  // Get all share_channel events in range with boardId
  const events = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "share_channel",
      createdAt: { gte: since },
      boardId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      boardId: true,
      meta: true,
    },
  });

  // Keep only first per board
  const seenBoards = new Set();
  const firstEvents = [];
  for (const e of events) {
    if (!seenBoards.has(e.boardId)) {
      seenBoards.add(e.boardId);
      firstEvents.push(e);
    }
  }

  // Group by channel
  const channels = {};
  for (const e of firstEvents) {
    const ch = e.meta?.channel || "unknown";
    channels[ch] = (channels[ch] || 0) + 1;
  }

  // Friendly names
  const friendlyNames = {
    whatsapp: "WhatsApp",
    email: "Email",
    sms: "SMS",
    copy: "Copy link",
    native: "Share sheet",
    unknown: "Other",
  };

  const result = [];
  for (const [key, count] of Object.entries(channels)) {
    result.push({ channel: key, label: friendlyNames[key] || key, count });
  }

  result.sort((a, b) => b.count - a.count);
  return result;
}

/**
 * Vote rate by channel: for channels with 5+ boards.
 * Uses voter-based completion (at least one voter done).
 * @param {string} shop
 * @param {number} days
 * @param {number} minBoards
 */
async function getVoteRateByChannel(shop, days, minBoards = 5) {
  const { since } = getDateRange(days);

  // Get share_channel events with boardId
  const events = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "share_channel",
      createdAt: { gte: since },
      boardId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { boardId: true, meta: true },
  });

  // First share per board
  const seenBoards = new Set();
  const boardChannel = new Map();
  for (const e of events) {
    if (!seenBoards.has(e.boardId)) {
      seenBoards.add(e.boardId);
      const ch = e.meta?.channel || "unknown";
      boardChannel.set(e.boardId, ch);
    }
  }

  // Get boards with at least one voter done
  const votedBoards = await prisma.board.findMany({
    where: {
      id: { in: Array.from(boardChannel.keys()) },
    },
    select: {
      id: true,
      voters: { select: { completedAt: true } },
    },
  });

  const votedIds = new Set(
    votedBoards.filter((b) => b.voters.some((v) => v.completedAt)).map((b) => b.id)
  );

  // Aggregate by channel
  const channelStats = {};
  for (const [boardId, channel] of boardChannel) {
    if (!channelStats[channel]) {
      channelStats[channel] = { total: 0, voted: 0 };
    }
    channelStats[channel].total++;
    if (votedIds.has(boardId)) {
      channelStats[channel].voted++;
    }
  }

  // Filter channels with minBoards
  const friendlyNames = {
    whatsapp: "WhatsApp",
    email: "Email",
    sms: "SMS",
    copy: "Copy link",
    native: "Share sheet",
    unknown: "Other",
  };

  const result = [];
  for (const [channel, stats] of Object.entries(channelStats)) {
    if (stats.total >= minBoards) {
      const rate = Math.round((stats.voted / stats.total) * 100);
      result.push({
        channel,
        label: friendlyNames[channel] || channel,
        total: stats.total,
        voted: stats.voted,
        rate,
      });
    }
  }

  result.sort((a, b) => b.rate - a.rate);
  return result;
}

/**
 * Why partners pass/maybe: top reasons by count.
 * Includes "In their own words" list for "other" texts.
 * @param {string} shop
 * @param {number} days
 */
async function getPartnerReasons(shop, days) {
  const { since } = getDateRange(days);

  // Get boards shared in range
  const boards = await prisma.board.findMany({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
    select: { id: true },
  });

  if (boards.length === 0) return { pass: [], maybe: [], total: 0, otherTexts: [] };

  const boardIds = boards.map((b) => b.id);

  // Get votes with reasons from items in these boards
  const items = await prisma.boardItem.findMany({
    where: { boardId: { in: boardIds } },
    select: {
      productId: true,
      votes: {
        where: { reason: { not: null } },
        select: { verdict: true, reason: true, reasonText: true, createdAt: true },
      },
    },
  });

  // Count reasons by verdict
  const passCounts = {};
  const maybeCounts = {};
  let total = 0;

  // Collect "other" texts (latest 10)
  const otherTextsRaw = [];

  for (const item of items) {
    for (const vote of item.votes) {
      total++;
      if (vote.verdict === "PASS") {
        passCounts[vote.reason] = (passCounts[vote.reason] || 0) + 1;
      } else if (vote.verdict === "MAYBE") {
        maybeCounts[vote.reason] = (maybeCounts[vote.reason] || 0) + 1;
      }
      // Collect "other" texts with product ID for title lookup
      if (vote.reason === "other" && vote.reasonText) {
        otherTextsRaw.push({
          text: vote.reasonText,
          productId: item.productId,
          verdict: vote.verdict,
          createdAt: vote.createdAt,
        });
      }
    }
  }

  // Sort by count
  const passReasons = Object.entries(passCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const maybeReasons = Object.entries(maybeCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // Get latest 10 "other" texts, sorted by createdAt desc
  const otherTexts = otherTextsRaw
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((o) => ({
      text: o.text,
      productId: o.productId,
      verdict: o.verdict,
    }));

  return { pass: passReasons, maybe: maybeReasons, total, otherTexts };
}

/**
 * Group voting stats for analytics card.
 * Returns: boards by voter count, avg people per board, % with prices hidden, % with group link.
 * @param {string} shop
 * @param {number} days
 */
async function getGroupVotingStats(shop, days) {
  const { since } = getDateRange(days);

  const boards = await prisma.board.findMany({
    where: {
      shop,
      status: { in: ["SHARED", "VOTED"] },
      sharedAt: { gte: since },
    },
    select: {
      hidePrices: true,
      groupToken: true,
      _count: { select: { voters: true } },
    },
  });

  if (boards.length === 0) {
    return {
      byVoterCount: { solo: 0, small: 0, large: 0 },
      avgVotersPerBoard: 0,
      pctHidePrices: 0,
      pctGroupLink: 0,
    };
  }

  // Count boards by voter count: 1 (solo), 2-3 (small), 4-5 (large)
  let solo = 0, small = 0, large = 0;
  let totalVoters = 0;
  let hidePricesCount = 0;
  let groupLinkCount = 0;

  for (const b of boards) {
    const vc = b._count.voters;
    totalVoters += vc;
    if (vc === 1) solo++;
    else if (vc <= 3) small++;
    else large++;
    if (b.hidePrices) hidePricesCount++;
    if (b.groupToken) groupLinkCount++;
  }

  return {
    byVoterCount: { solo, small, large },
    avgVotersPerBoard: Math.round((totalVoters / boards.length) * 10) / 10,
    pctHidePrices: Math.round((hidePricesCount / boards.length) * 100),
    pctGroupLink: Math.round((groupLinkCount / boards.length) * 100),
  };
}

/**
 * Main dashboard data loader.
 * Runs queries in parallel for performance.
 * @param {string} shop
 * @param {number} days
 */
export async function getDashboardData(shop, days) {
  const validDays = parseRange(days);

  const [
    revenue,
    dailyRevenue,
    boardsShared,
    voteRate,
    funnel,
    latestOrders,
    topProducts,
    productFeedback,
    sharesByChannel,
    voteRateByChannel,
    partnerReasons,
    groupVotingStats,
    notifyStats,
    firstEventDate,
  ] = await Promise.all([
    getRevenueData(shop, validDays),
    getDailyRevenue(shop, validDays),
    getBoardsShared(shop, validDays),
    getVoteRate(shop, validDays),
    getFunnelData(shop, validDays),
    getLatestOrders(shop, validDays),
    getTopSharedProducts(shop, validDays),
    getProductFeedback(shop, validDays),
    getSharesByChannel(shop, validDays),
    getVoteRateByChannel(shop, validDays),
    getPartnerReasons(shop, validDays),
    getGroupVotingStats(shop, validDays),
    getNotificationStats(shop),
    getFirstEventDate(shop),
  ]);

  // Calculate AOV
  const aov =
    revenue.orderCount > 0
      ? Math.round(revenue.valueCents / revenue.orderCount)
      : 0;

  return {
    range: validDays,
    revenue,
    dailyRevenue,
    boardsShared,
    voteRate,
    funnel,
    latestOrders,
    topProducts,
    productFeedback,
    sharesByChannel,
    voteRateByChannel,
    partnerReasons,
    groupVotingStats,
    notifyStats,
    aov,
    firstEventDate,
  };
}

/**
 * Fetch product titles from Admin API.
 * Returns { map, ok } so loader can distinguish error from deleted product.
 * @param {object} admin - Shopify Admin API client
 * @param {string[]} productIds - Array of product GIDs
 * @returns {Promise<{ map: Map<string, string>, ok: boolean }>}
 */
export async function fetchProductTitles(admin, productIds) {
  if (!productIds.length) return { map: new Map(), ok: true };

  try {
    const response = await admin.graphql(
      `query GetProductTitles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
          }
        }
      }`,
      { variables: { ids: productIds } }
    );

    const json = await response.json();

    if (json.errors) {
      log.warn("dashboard.titles_failed", { count: productIds.length });
      return { map: new Map(), ok: false };
    }

    const titleMap = new Map();
    for (const node of json.data?.nodes || []) {
      if (node?.id && node?.title) {
        titleMap.set(node.id, node.title);
      }
    }

    return { map: titleMap, ok: true };
  } catch {
    log.warn("dashboard.titles_failed", { count: productIds.length });
    return { map: new Map(), ok: false };
  }
}
