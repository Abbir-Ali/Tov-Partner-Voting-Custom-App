/**
 * Audit queries for the Boards admin page.
 * Read-only, scoped by shop. Never selects notes or emails.
 */
import prisma from "../db.server.js";
import { log } from "../utils/log.server.js";

const PAGE_SIZE = 25;

/**
 * Get boards for audit page with pagination.
 * @param {string} shop
 * @param {object} options - { cursor, filter }
 * @returns {Promise<{ boards: array, nextCursor: string|null }>}
 */
export async function getAuditBoards(shop, { cursor, filter } = {}) {
  // Base filter: shared or voted boards only
  const where = {
    shop,
    status: { in: ["SHARED", "VOTED"] },
  };

  // Apply filter
  if (filter === "orders") {
    // Boards that have an order_from_board event
    const orderEvents = await prisma.analyticsEvent.findMany({
      where: { shop, type: "order_from_board", boardId: { not: null } },
      select: { boardId: true },
      distinct: ["boardId"],
    });
    where.id = { in: orderEvents.map((e) => e.boardId) };
  } else if (filter === "repeat") {
    // Customers with 2+ board orders all-time
    const repeatCustomers = await getRepeatBuyerCustomerIds(shop);
    const orderEvents = await prisma.analyticsEvent.findMany({
      where: {
        shop,
        type: "order_from_board",
        boardId: { not: null },
        customerId: { in: repeatCustomers },
      },
      select: { boardId: true },
      distinct: ["boardId"],
    });
    where.id = { in: orderEvents.map((e) => e.boardId) };
  }

  // Cursor pagination
  const cursorClause = cursor ? { cursor: { id: cursor }, skip: 1 } : {};

  const boards = await prisma.board.findMany({
    where,
    orderBy: { sharedAt: "desc" },
    take: PAGE_SIZE + 1, // +1 to check if there's more
    ...cursorClause,
    select: {
      id: true,
      customerId: true,
      ownerFirstName: true,
      partnerFirstName: true,
      status: true,
      sharedAt: true,
      partnerOpenedAt: true,
      votingCompletedAt: true,
      expiresAt: true,
      items: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          votes: { select: { verdict: true } },
        },
      },
    },
  });

  // Check for next page
  const hasMore = boards.length > PAGE_SIZE;
  if (hasMore) boards.pop();

  // Get order events for these boards
  const boardIds = boards.map((b) => b.id);
  const orderEvents = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      boardId: { in: boardIds },
    },
    select: {
      boardId: true,
      orderId: true,
      customerId: true,
      valueCents: true,
      currencyCode: true,
      meta: true,
    },
  });

  // Map order events by boardId
  const orderMap = new Map();
  for (const e of orderEvents) {
    if (e.boardId) orderMap.set(e.boardId, e);
  }

  // Build result
  const result = boards.map((b) => {
    const order = orderMap.get(b.id);
    const loveCount = b.items.filter((i) => i.votes[0]?.verdict === "LOVE").length;
    const maybeCount = b.items.filter((i) => i.votes[0]?.verdict === "MAYBE").length;
    const passCount = b.items.filter((i) => i.votes[0]?.verdict === "PASS").length;

    // Status text
    let statusText = "Shared";
    if (b.expiresAt && b.expiresAt < new Date()) {
      statusText = "Expired";
    } else if (b.votingCompletedAt) {
      statusText = "Voted";
    } else if (b.partnerOpenedAt) {
      statusText = "Opened";
    }

    return {
      id: b.id,
      shopperCustomerId: b.customerId,
      shopperFirstName: b.ownerFirstName,
      partnerFirstName: b.partnerFirstName,
      pieceCount: b.items.length,
      loveCount,
      maybeCount,
      passCount,
      status: statusText,
      sharedAt: b.sharedAt,
      order: order
        ? {
            orderId: order.orderId,
            orderName: order.meta?.orderName || "Order",
            customerId: order.customerId,
            valueCents: order.valueCents,
            currencyCode: order.currencyCode || "USD",
          }
        : null,
      items: b.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        verdict: i.votes[0]?.verdict || null,
      })),
    };
  });

  return {
    boards: result,
    nextCursor: hasMore ? boards[boards.length - 1].id : null,
  };
}

/**
 * Get customer IDs with 2+ board orders (repeat buyers).
 * Excludes guests (null and "" both mean guest).
 * @param {string} shop
 * @returns {Promise<string[]>}
 */
async function getRepeatBuyerCustomerIds(shop) {
  const events = await prisma.analyticsEvent.groupBy({
    by: ["customerId"],
    where: {
      shop,
      type: "order_from_board",
      customerId: { not: null, notIn: [""] },
    },
    _count: true,
  });

  return events
    .filter((e) => e._count >= 2 && e.customerId)
    .map((e) => e.customerId);
}

/**
 * Get top board customers by revenue in a range.
 * @param {string} shop
 * @param {number} days
 * @param {number} limit
 * @returns {Promise<{ customers: array, guestCount: number }>}
 */
export async function getTopBoardCustomers(shop, days, limit = 10) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      createdAt: { gte: since },
    },
    select: {
      customerId: true,
      valueCents: true,
    },
  });

  // Count guests (null or "" both mean guest)
  const guestCount = events.filter((e) => !e.customerId || e.customerId === "").length;

  // Aggregate by customer (exclude null and "")
  const customerMap = new Map();
  for (const e of events) {
    if (!e.customerId || e.customerId === "") continue;
    const existing = customerMap.get(e.customerId) || { orders: 0, revenue: 0 };
    existing.orders++;
    existing.revenue += e.valueCents || 0;
    customerMap.set(e.customerId, existing);
  }

  // Get all-time order counts for repeat detection (exclude null and "")
  const allTimeEvents = await prisma.analyticsEvent.groupBy({
    by: ["customerId"],
    where: {
      shop,
      type: "order_from_board",
      customerId: { not: null, notIn: [""] },
    },
    _count: true,
  });
  const allTimeMap = new Map(allTimeEvents.map((e) => [e.customerId, e._count]));

  // Build result
  const customers = Array.from(customerMap.entries())
    .map(([customerId, data]) => ({
      customerId,
      orders: data.orders,
      revenue: data.revenue,
      isRepeat: (allTimeMap.get(customerId) || 0) >= 2,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  return { customers, guestCount };
}

/**
 * Fetch customer display names from Admin API.
 * @param {object} admin - Shopify Admin API client
 * @param {string[]} customerIds - Array of customer GIDs
 * @returns {Promise<{ map: Map<string, string>, ok: boolean }>}
 */
export async function fetchCustomerNames(admin, customerIds) {
  if (!customerIds.length) return { map: new Map(), ok: true };

  // Filter out empty strings (guest markers)
  const validIds = customerIds.filter((id) => id && id !== "");
  if (!validIds.length) return { map: new Map(), ok: true };

  try {
    const response = await admin.graphql(
      `query GetCustomerNames($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            displayName
          }
        }
      }`,
      { variables: { ids: validIds } }
    );

    const json = await response.json();

    if (json.errors) {
      log.warn("audit.customer_names_failed", { count: validIds.length });
      return { map: new Map(), ok: false };
    }

    const nameMap = new Map();
    for (const node of json.data?.nodes || []) {
      if (node?.id && node?.displayName) {
        nameMap.set(node.id, node.displayName);
      }
    }

    return { map: nameMap, ok: true };
  } catch {
    log.warn("audit.customer_names_failed", { count: validIds.length });
    return { map: new Map(), ok: false };
  }
}

/**
 * Fetch product titles from Admin API.
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
      log.warn("audit.product_titles_failed", { count: productIds.length });
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
    log.warn("audit.product_titles_failed", { count: productIds.length });
    return { map: new Map(), ok: false };
  }
}

/**
 * Fetch variant titles from Admin API.
 * Returns variant title and parent product title.
 * @param {object} admin - Shopify Admin API client
 * @param {string[]} variantIds - Array of variant GIDs
 * @returns {Promise<{ map: Map<string, { variantTitle: string, productTitle: string }>, ok: boolean }>}
 */
export async function fetchVariantTitles(admin, variantIds) {
  if (!variantIds.length) return { map: new Map(), ok: true };

  try {
    const response = await admin.graphql(
      `query GetVariantTitles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            product { title }
          }
        }
      }`,
      { variables: { ids: variantIds } }
    );

    const json = await response.json();

    if (json.errors) {
      log.warn("audit.variant_titles_failed", { count: variantIds.length });
      return { map: new Map(), ok: false };
    }

    const titleMap = new Map();
    for (const node of json.data?.nodes || []) {
      if (node?.id) {
        titleMap.set(node.id, {
          variantTitle: node.title || "Default Title",
          productTitle: node.product?.title || "Product",
        });
      }
    }

    return { map: titleMap, ok: true };
  } catch {
    log.warn("audit.variant_titles_failed", { count: variantIds.length });
    return { map: new Map(), ok: false };
  }
}
