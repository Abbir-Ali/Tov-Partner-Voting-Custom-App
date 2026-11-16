/**
 * Sidekick tool handlers.
 * PRIVACY RULE: Customer names, board order counts and revenue only via
 * top_board_customers, only when the merchant asks. Never emails, phones,
 * addresses, notes or partner names.
 */
import prisma from "../db.server.js";
import { getNotificationStats } from "./notify.server.js";
import { getSettings } from "../models/settings.server.js";
import { getTopBoardCustomers, fetchCustomerNames } from "./audit.server.js";
import { log } from "../utils/log.server.js";

// In-memory cache: key -> { data, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function cacheKey(shop, tool, params) {
  return `${shop}:${tool}:${JSON.stringify(params)}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Valid days values
const VALID_DAYS = new Set([7, 14, 30, 60]);

function parseDays(val) {
  const n = parseInt(val, 10);
  return VALID_DAYS.has(n) ? n : 30;
}

function parseLimit(val) {
  const n = parseInt(val, 10);
  if (!Number.isInteger(n) || n < 1) return 10;
  return Math.min(n, 10);
}

/**
 * board_performance: revenue, orders, AOV, vote rate, funnel
 */
export async function boardPerformance(shop, params) {
  const days = parseDays(params.days);
  const key = cacheKey(shop, "board_performance", { days });
  const cached = getCached(key);
  if (cached) return cached;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Revenue and orders
  const orderAgg = await prisma.analyticsEvent.aggregate({
    where: { shop, type: "order_from_board", createdAt: { gte: since } },
    _sum: { valueCents: true },
    _count: true,
  });

  const revenue = orderAgg._sum.valueCents || 0;
  const orders = orderAgg._count;
  const aov = orders > 0 ? Math.round(revenue / orders) : 0;

  // Currency from latest order
  const latestOrder = await prisma.analyticsEvent.findFirst({
    where: { shop, type: "order_from_board", currencyCode: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { currencyCode: true },
  });
  const currency = latestOrder?.currencyCode || "USD";

  // Vote rate: boards shared vs voted
  const baseWhere = { shop, status: { in: ["SHARED", "VOTED"] }, sharedAt: { gte: since } };
  const [shared, voted] = await Promise.all([
    prisma.board.count({ where: baseWhere }),
    prisma.board.count({ where: { ...baseWhere, votingCompletedAt: { not: null } } }),
  ]);
  const voteRate = shared > 0 ? Math.round((voted / shared) * 100) : 0;

  // Funnel counts
  const impressionVisitors = await prisma.analyticsEvent.findMany({
    where: { shop, type: "button_impression", createdAt: { gte: since }, visitorHash: { not: null } },
    distinct: ["visitorHash"],
    select: { visitorHash: true },
  });

  const eventCounts = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: { shop, createdAt: { gte: since }, type: { in: ["button_save", "results_add_loved", "order_from_board"] } },
    _count: true,
  });
  const countMap = {};
  for (const row of eventCounts) countMap[row.type] = row._count;

  const [partnerOpened, votingDone] = await Promise.all([
    prisma.board.count({ where: { ...baseWhere, partnerOpenedAt: { not: null } } }),
    prisma.board.count({ where: { ...baseWhere, votingCompletedAt: { not: null } } }),
  ]);

  // Get earliest tracking event date for funnel note
  const firstTrackingEvent = await prisma.analyticsEvent.findFirst({
    where: { shop, type: { in: ["button_impression", "button_save"] } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const trackingSince = firstTrackingEvent?.createdAt?.toISOString().slice(0, 10) || null;

  const data = {
    days,
    revenueCents: revenue,
    currency,
    orders,
    aovCents: aov,
    voteRatePct: voteRate,
    votedBoards: voted,
    sharedBoards: shared,
    funnel: {
      buttonSeen: impressionVisitors.length,
      saved: countMap["button_save"] || 0,
      shared,
      partnerOpened,
      votingDone,
      addedToCart: countMap["results_add_loved"] || 0,
      ordered: orders,
    },
    funnelNote: trackingSince
      ? `Button seen and Saved to board come from storefront tracking: only visitors who accepted analytics cookies, and only since ${trackingSince}. Shared, opened and voted come from every board.`
      : "Button seen and Saved to board come from storefront tracking (visitors who accepted analytics cookies). Shared, opened and voted come from every board.",
    note: "An order counts only when its cart was filled from a board's results page.",
  };

  setCache(key, data);
  return data;
}

/**
 * top_shared_products: product title, GID, boards count, % loved
 */
export async function topSharedProducts(shop, admin, params) {
  const days = parseDays(params.days);
  const limit = parseLimit(params.limit);
  const key = cacheKey(shop, "top_shared_products", { days, limit });
  const cached = getCached(key);
  if (cached) return cached;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get boards shared in range
  const boards = await prisma.board.findMany({
    where: { shop, status: { in: ["SHARED", "VOTED"] }, sharedAt: { gte: since } },
    select: { id: true },
  });

  if (boards.length === 0) {
    const data = { days, products: [] };
    setCache(key, data);
    return data;
  }

  const boardIds = boards.map((b) => b.id);

  // Get all items with votes
  const items = await prisma.boardItem.findMany({
    where: { boardId: { in: boardIds } },
    select: { boardId: true, productId: true, votes: { select: { verdict: true } } },
  });

  // Count boards and votes per product
  const productStats = new Map();
  for (const item of items) {
    if (!productStats.has(item.productId)) {
      productStats.set(item.productId, { boards: new Set(), love: 0, total: 0 });
    }
    const p = productStats.get(item.productId);
    p.boards.add(item.boardId);
    if (item.votes[0]) {
      p.total++;
      if (item.votes[0].verdict === "LOVE") p.love++;
    }
  }

  // Sort by board count
  const sorted = Array.from(productStats.entries())
    .map(([productId, stats]) => ({
      productId,
      boardCount: stats.boards.size,
      lovePct: stats.total >= 5 ? Math.round((stats.love / stats.total) * 100) : null,
    }))
    .sort((a, b) => b.boardCount - a.boardCount)
    .slice(0, limit);

  // Fetch product titles in one call
  const productIds = sorted.map((p) => p.productId);
  let titleMap = new Map();
  if (productIds.length > 0) {
    try {
      const response = await admin.graphql(
        `query GetProductTitles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } } }`,
        { variables: { ids: productIds } }
      );
      const json = await response.json();
      for (const node of json.data?.nodes || []) {
        if (node?.id && node?.title) titleMap.set(node.id, node.title);
      }
    } catch {
      // Titles unavailable
    }
  }

  const products = sorted.map((p) => ({
    productId: p.productId,
    title: titleMap.get(p.productId) || "Product",
    boardCount: p.boardCount,
    lovePct: p.lovePct,
    adminUrl: `shopify:admin/products/${p.productId.split("/").pop()}`,
  }));

  const data = { days, products };
  setCache(key, data);
  return data;
}

/**
 * product_partner_feedback: votes for a specific product
 * Optimized cold start: search for product by title (max 5 results),
 * filter to ones in our board_items, then count votes.
 * Warm: uses 10-minute cache of product titles.
 */
export async function productPartnerFeedback(shop, admin, params) {
  const { product_title, product_id } = params;

  let productId = product_id;
  let productTitle = null;

  if (!productId && product_title) {
    const titleKey = cacheKey(shop, "product_titles", {});
    let titleMap = getCached(titleKey);

    if (titleMap) {
      // Warm path: search cached titles
      const searchLower = product_title.toLowerCase();
      for (const [id, title] of titleMap) {
        if (title.toLowerCase().includes(searchLower)) {
          productId = id;
          productTitle = title;
          break;
        }
      }
    } else {
      // Cold path: search Admin API directly, filter to board products
      const searchText = product_title.slice(0, 100).replace(/"/g, '\\"');
      try {
        const response = await admin.graphql(
          `query SearchProducts($query: String!) {
            products(first: 5, query: $query) {
              nodes { id title }
            }
          }`,
          { variables: { query: `title:*${searchText}*` } }
        );
        const json = await response.json();
        const candidates = json.data?.products?.nodes || [];

        if (candidates.length > 0) {
          // Get product IDs that exist in our board_items
          const candidateIds = candidates.map((c) => c.id);
          const boardProducts = await prisma.boardItem.findMany({
            where: { productId: { in: candidateIds }, board: { shop } },
            distinct: ["productId"],
            select: { productId: true },
          });
          const boardProductIds = new Set(boardProducts.map((b) => b.productId));

          // Pick first candidate that exists in board_items
          for (const c of candidates) {
            if (boardProductIds.has(c.id)) {
              productId = c.id;
              productTitle = c.title;
              break;
            }
          }
        }
      } catch {
        // Search failed, fall through to error
      }
    }

    if (!productId) {
      return { error: "Product not found on any board. Try a different search term." };
    }
  }

  if (!productId) {
    return { error: "Provide a product title or ID." };
  }

  // Get title from cache or single API call if we only have ID
  if (!productTitle && productId) {
    const titleKey = cacheKey(shop, "product_titles", {});
    const titleMap = getCached(titleKey);
    productTitle = titleMap?.get(productId);

    if (!productTitle) {
      try {
        const response = await admin.graphql(
          `query GetProduct($id: ID!) { product(id: $id) { title } }`,
          { variables: { id: productId } }
        );
        const json = await response.json();
        productTitle = json.data?.product?.title || "Product";
      } catch {
        productTitle = "Product";
      }
    }
  }

  // Get votes for this product
  const items = await prisma.boardItem.findMany({
    where: { productId, board: { shop } },
    select: { votes: { select: { verdict: true } } },
  });

  let love = 0, maybe = 0, pass = 0;
  for (const item of items) {
    const v = item.votes[0]?.verdict;
    if (v === "LOVE") love++;
    else if (v === "MAYBE") maybe++;
    else if (v === "PASS") pass++;
  }

  const total = love + maybe + pass;
  if (total < 5) {
    return {
      productId,
      title: productTitle,
      message: "Not enough votes yet (need 5+)",
      totalVotes: total,
    };
  }

  return {
    productId,
    title: productTitle,
    loved: love,
    maybe,
    notForUs: pass,
    totalVotes: total,
    lovePct: Math.round((love / total) * 100),
    adminUrl: `shopify:admin/products/${productId.split("/").pop()}`,
  };
}

/**
 * orders_from_boards: recent orders (NO customer info)
 */
export async function ordersFromBoards(shop, params) {
  const days = parseDays(params.days);
  const limit = parseLimit(params.limit);
  const key = cacheKey(shop, "orders_from_boards", { days, limit });
  const cached = getCached(key);
  if (cached) return cached;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const orders = await prisma.analyticsEvent.findMany({
    where: { shop, type: "order_from_board", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { orderId: true, boardId: true, valueCents: true, currencyCode: true, createdAt: true, meta: true },
  });

  // Get board item counts and loved counts
  const boardIds = orders.map((o) => o.boardId).filter(Boolean);
  const boardsData = boardIds.length
    ? await prisma.board.findMany({
        where: { id: { in: boardIds } },
        select: { id: true, items: { select: { votes: { select: { verdict: true } } } } },
      })
    : [];
  const boardMap = new Map(boardsData.map((b) => [b.id, b]));

  const results = orders.map((o) => {
    const board = o.boardId ? boardMap.get(o.boardId) : null;
    const pieces = board?.items.length || 0;
    const loved = board?.items.filter((i) => i.votes[0]?.verdict === "LOVE").length || 0;
    const numericId = o.orderId?.match(/Order\/(\d+)$/)?.[1];

    return {
      orderName: o.meta?.orderName || "Order",
      date: o.createdAt.toISOString().slice(0, 10),
      amountCents: o.valueCents,
      currency: o.currencyCode || "USD",
      pieces,
      loved,
      adminUrl: numericId ? `shopify:admin/orders/${numericId}` : null,
    };
  });

  const data = { days, orders: results };
  setCache(key, data);
  return data;
}

/**
 * shares_by_channel: channel counts and vote rates
 */
export async function sharesByChannel(shop, params) {
  const days = parseDays(params.days);
  const key = cacheKey(shop, "shares_by_channel", { days });
  const cached = getCached(key);
  if (cached) return cached;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get share_channel events
  const events = await prisma.analyticsEvent.findMany({
    where: { shop, type: "share_channel", createdAt: { gte: since }, boardId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { boardId: true, meta: true },
  });

  // First share per board
  const seenBoards = new Set();
  const boardChannel = new Map();
  for (const e of events) {
    if (!seenBoards.has(e.boardId)) {
      seenBoards.add(e.boardId);
      boardChannel.set(e.boardId, e.meta?.channel || "unknown");
    }
  }

  // Get voted boards
  const votedBoards = await prisma.board.findMany({
    where: { id: { in: Array.from(boardChannel.keys()) }, votingCompletedAt: { not: null } },
    select: { id: true },
  });
  const votedIds = new Set(votedBoards.map((b) => b.id));

  // Aggregate by channel
  const channelStats = {};
  for (const [boardId, channel] of boardChannel) {
    if (!channelStats[channel]) channelStats[channel] = { total: 0, voted: 0 };
    channelStats[channel].total++;
    if (votedIds.has(boardId)) channelStats[channel].voted++;
  }

  const friendlyNames = {
    whatsapp: "WhatsApp",
    email: "Email",
    sms: "SMS",
    copy: "Copy link",
    native: "Share sheet",
    unknown: "Other",
  };

  const channels = Object.entries(channelStats)
    .map(([channel, stats]) => ({
      channel: friendlyNames[channel] || channel,
      shares: stats.total,
      voteRatePct: stats.total >= 5 ? Math.round((stats.voted / stats.total) * 100) : null,
    }))
    .sort((a, b) => b.shares - a.shares);

  const data = { days, channels };
  setCache(key, data);
  return data;
}

/**
 * notification_health: email stats and Klaviyo status
 */
export async function notificationHealth(shop) {
  const key = cacheKey(shop, "notification_health", {});
  const cached = getCached(key);
  if (cached) return cached;

  const [stats, settings] = await Promise.all([
    getNotificationStats(shop),
    getSettings(shop),
  ]);

  const data = {
    sent: stats.sent,
    pending: stats.pending,
    failed: stats.failed,
    klaviyoConnected: !!settings.klaviyoKeyEncrypted,
    note: "Counts are for the last 30 days of voting-done emails.",
  };

  setCache(key, data);
  return data;
}

/**
 * top_board_customers: customer names, orders, revenue (only when merchant asks)
 * PRIVACY: names only, never emails/phones/addresses/notes/partner names
 */
export async function topBoardCustomers(shop, admin, params) {
  const days = parseDays(params.days);
  const limit = parseLimit(params.limit);
  const repeatOnly = params.repeat_only === true || params.repeat_only === "true";
  const key = cacheKey(shop, "top_board_customers", { days, limit, repeatOnly });
  const cached = getCached(key);
  if (cached) return cached;

  // Get customer data from audit service
  const { customers, guestCount } = await getTopBoardCustomers(shop, days, limit * 2);

  // Filter to repeat-only if requested
  let filtered = repeatOnly ? customers.filter((c) => c.isRepeat) : customers;
  filtered = filtered.slice(0, limit);

  if (filtered.length === 0) {
    const data = { days, customers: [], guestCheckouts: guestCount };
    setCache(key, data);
    return data;
  }

  // Fetch customer names from Admin API
  const customerIds = filtered.map((c) => c.customerId);
  const { map: nameMap } = await fetchCustomerNames(admin, customerIds);

  // Get currency from latest order
  const latestOrder = await prisma.analyticsEvent.findFirst({
    where: { shop, type: "order_from_board", currencyCode: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { currencyCode: true },
  });
  const currency = latestOrder?.currencyCode || "USD";

  const result = filtered.map((c) => {
    const numericId = c.customerId.match(/Customer\/(\d+)$/)?.[1];
    return {
      name: nameMap.get(c.customerId) || "Customer",
      boardOrders: c.orders,
      revenueCents: c.revenue,
      status: c.isRepeat ? "repeat" : "first",
      adminUrl: numericId ? `shopify:admin/customers/${numericId}` : null,
    };
  });

  const data = { days, currency, customers: result, guestCheckouts: guestCount };
  setCache(key, data);
  return data;
}

/**
 * Execute a tool by name
 */
export async function executeTool(shop, admin, tool, params) {
  const start = Date.now();

  let data;
  switch (tool) {
    case "board_performance":
      data = await boardPerformance(shop, params);
      break;
    case "top_shared_products":
      data = await topSharedProducts(shop, admin, params);
      break;
    case "product_partner_feedback":
      data = await productPartnerFeedback(shop, admin, params);
      break;
    case "orders_from_boards":
      data = await ordersFromBoards(shop, params);
      break;
    case "shares_by_channel":
      data = await sharesByChannel(shop, params);
      break;
    case "notification_health":
      data = await notificationHealth(shop);
      break;
    case "top_board_customers":
      data = await topBoardCustomers(shop, admin, params);
      break;
    default:
      return null;
  }

  const ms = Date.now() - start;
  log.info("sidekick.tool", { shop, tool, ms });

  return data;
}
