/**
 * Audit queries for the Boards admin page.
 * Read-only, scoped by shop. Never selects notes or emails.
 */
import prisma from "../db.server.js";
import { log } from "../utils/log.server.js";
import { SAVED_VIEWS, SORT_OPTIONS } from "../models/boards-list.shared.js";
import {
  getBoardStatus,
  getVoteCounts,
  formatVotersForDisplay,
  getVoterSummaryText,
} from "../models/board-metrics.shared.js";

const PAGE_SIZE = 25;

export { SAVED_VIEWS, SORT_OPTIONS };

/**
 * Get summary counts for the boards page header cards.
 * @param {string} shop
 * @param {object} filters - { from, to } date range
 * @returns {Promise<{ shared: number, waiting: number, partlyVoted: number, voted: number, ordered: number }>}
 */
export async function getBoardSummaryCounts(shop, { from, to } = {}) {
  const dateFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  const baseWhere = {
    shop,
    status: { in: ["SHARED", "VOTED"] },
    ...(hasDateFilter ? { sharedAt: dateFilter } : {}),
  };

  // Get boards with voter status for waiting/partlyVoted/voted counts
  const boards = await prisma.board.findMany({
    where: baseWhere,
    select: {
      id: true,
      expiresAt: true,
      voters: {
        select: { kind: true, completedAt: true },
      },
    },
  });

  const shared = boards.length;
  let waiting = 0;
  let partlyVoted = 0;
  let voted = 0;
  const now = new Date();

  for (const b of boards) {
    const isExpired = b.expiresAt && b.expiresAt < now;
    if (isExpired) continue;

    const personalVoters = b.voters.filter((v) => v.kind === "PERSONAL");
    const doneVoters = b.voters.filter((v) => v.completedAt);
    const donePersonal = personalVoters.filter((v) => v.completedAt);
    const allPersonalDone = personalVoters.length > 0 &&
      donePersonal.length === personalVoters.length;

    if (allPersonalDone) {
      voted++;
    } else if (doneVoters.length > 0) {
      partlyVoted++;
    } else {
      waiting++;
    }
  }

  // Count boards with orders
  const orderEvents = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      boardId: { not: null },
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
    select: { boardId: true },
    distinct: ["boardId"],
  });

  return { shared, waiting, partlyVoted, voted, ordered: orderEvents.length };
}

/**
 * Get boards for audit page with full server-side filtering, sorting, pagination.
 * @param {string} shop
 * @param {object} options - filters, sort, pagination
 * @param {object} [admin] - Shopify Admin API client (for product search)
 * @returns {Promise<{ boards: array, total: number, page: number, pageCount: number }>}
 */
export async function getAuditBoards(shop, options = {}, admin = null) {
  const timing = process.env.PVB_TIMING === "1";
  const t = timing ? (label) => { console.time(label); return label; } : () => null;
  const te = timing ? (label) => console.timeEnd(label) : () => {};

  const {
    view = "all",
    q = "",
    status,
    from,
    to,
    hasOrder,
    shopperType,
    via,
    productId,
    reason,
    pieces,
    voterCount,   // "1", "2-3", "4-5"
    hidePrices,   // "yes", "no"
    sort = "newest",
    page = 1,
    dateRange, // "7", "30", "90", "all"
  } = options;

  // Base filter: shared or voted boards only
  const where = {
    shop,
    status: { in: ["SHARED", "VOTED"] },
  };

  // Date range filter (from dateRange preset or from/to)
  if (dateRange && dateRange !== "all") {
    const days = parseInt(dateRange, 10);
    if (!isNaN(days)) {
      where.sharedAt = { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }
  } else if (from || to) {
    where.sharedAt = {};
    if (from) where.sharedAt.gte = new Date(from);
    if (to) {
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);
      where.sharedAt.lte = endOfDay;
    }
  }

  // Status filter using voters
  // "waiting" = no PERSONAL voter has completedAt, not expired
  // "voted" = all PERSONAL voters have completedAt
  // "partly" = some voters done but not all PERSONAL done
  // "expired" = past expiry date
  if (status === "waiting") {
    where.expiresAt = { gte: new Date() };
    // No PERSONAL voter has completed
    where.voters = { none: { kind: "PERSONAL", completedAt: { not: null } } };
  } else if (status === "voted") {
    // All PERSONAL voters completed - we need post-filter since Prisma can't express "all"
    // For now use: at least one PERSONAL voter AND none with completedAt null
    where.voters = {
      some: { kind: "PERSONAL", completedAt: { not: null } },
    };
    // Will post-filter in result mapping
  } else if (status === "partly") {
    // Some done, some not - at least one done AND at least one PERSONAL not done
    where.expiresAt = { gte: new Date() };
    where.AND = [
      { voters: { some: { completedAt: { not: null } } } },
      { voters: { some: { kind: "PERSONAL", completedAt: null } } },
    ];
  } else if (status === "expired") {
    where.expiresAt = { lt: new Date() };
  }

  // Shopper type filter
  if (shopperType === "customer") {
    where.customerId = { not: null };
  } else if (shopperType === "guest") {
    where.customerId = null;
  }

  // Hide prices filter
  if (hidePrices === "yes") {
    where.hidePrices = true;
  } else if (hidePrices === "no") {
    where.hidePrices = false;
  }

  // Voter count filter: filter by number of voters
  // Handled after main query since Prisma can't filter by relation count in where

  // Saved view filters (override individual filters)
  if (view === "waiting") {
    delete where.voters;
    delete where.AND;
    where.expiresAt = { gte: new Date() };
    where.voters = { none: { kind: "PERSONAL", completedAt: { not: null } } };
  } else if (view === "voted_no_order") {
    delete where.voters;
    delete where.AND;
    where.voters = { some: { kind: "PERSONAL", completedAt: { not: null } } };
    // Will filter by no-order below
  } else if (view === "expiring") {
    delete where.voters;
    delete where.AND;
    const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    where.voters = { none: { kind: "PERSONAL", completedAt: { not: null } } };
    where.expiresAt = { gte: new Date(), lte: threeDays };
  }

  // Get board IDs with orders for filtering
  let boardIdsWithOrders = null;
  if (hasOrder !== undefined || view === "ordered" || view === "voted_no_order") {
    const orderEvents = await prisma.analyticsEvent.findMany({
      where: { shop, type: "order_from_board", boardId: { not: null } },
      select: { boardId: true },
      distinct: ["boardId"],
    });
    boardIdsWithOrders = new Set(orderEvents.map((e) => e.boardId));

    if (hasOrder === "yes" || view === "ordered") {
      where.id = { in: Array.from(boardIdsWithOrders) };
    } else if (hasOrder === "no" || view === "voted_no_order") {
      where.id = { notIn: Array.from(boardIdsWithOrders) };
    }
  }

  // Repeat buyers view
  if (view === "repeat") {
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

  // Product filter
  if (productId) {
    const boardsWithProduct = await prisma.boardItem.findMany({
      where: { productId, board: { shop } },
      select: { boardId: true },
      distinct: ["boardId"],
    });
    const productBoardIds = boardsWithProduct.map((b) => b.boardId);
    where.id = intersectIdFilter(where.id, productBoardIds);
  }

  // Reason filter
  if (reason) {
    const votesWithReason = await prisma.vote.findMany({
      where: {
        reason,
        boardItem: { board: { shop } },
      },
      select: { boardItem: { select: { boardId: true } } },
    });
    const reasonBoardIds = [...new Set(votesWithReason.map((v) => v.boardItem.boardId))];
    where.id = intersectIdFilter(where.id, reasonBoardIds);
  }

  // Channel (via) filter
  if (via) {
    const channelEvents = await prisma.analyticsEvent.findMany({
      where: {
        shop,
        type: "share_channel",
        boardId: { not: null },
        meta: { path: ["channel"], equals: via },
      },
      select: { boardId: true },
      distinct: ["boardId"],
    });
    const viaBoardIds = channelEvents.map((e) => e.boardId);
    where.id = intersectIdFilter(where.id, viaBoardIds);
  }

  // Search: voter name, shopper name, order number, product title
  // Run all search queries in parallel for speed
  if (q && q.trim()) {
    t("search");
    const searchTerm = q.trim().toLowerCase();
    const orderNumMatch = searchTerm.match(/^#?(\d+)$/);

    const searchPromises = [];

    // Search by voter firstName or shopper name
    searchPromises.push(
      prisma.board.findMany({
        where: {
          shop,
          status: { in: ["SHARED", "VOTED"] },
          OR: [
            { voters: { some: { firstName: { contains: searchTerm, mode: "insensitive" } } } },
            { ownerFirstName: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      }).then((r) => r.map((b) => b.id))
    );

    // Search by order number
    if (orderNumMatch) {
      const orderNum = orderNumMatch[1];
      searchPromises.push(
        prisma.analyticsEvent.findMany({
          where: {
            shop,
            type: "order_from_board",
            boardId: { not: null },
            meta: { path: ["orderName"], string_contains: orderNum },
          },
          select: { boardId: true },
        }).then((r) => r.filter((e) => e.boardId).map((e) => e.boardId))
      );
    }

    // Search by product title (via Admin API with cache)
    if (admin && searchTerm.length >= 2) {
      searchPromises.push(
        searchProductsByTitle(admin, shop, searchTerm).then(async (productIds) => {
          if (productIds.length === 0) return [];
          const productBoards = await prisma.boardItem.findMany({
            where: { productId: { in: productIds }, board: { shop } },
            select: { boardId: true },
            distinct: ["boardId"],
          });
          return productBoards.map((b) => b.boardId);
        })
      );
    }

    const searchResults = await Promise.all(searchPromises);
    const searchBoardIds = new Set(searchResults.flat());
    where.id = intersectIdFilter(where.id, Array.from(searchBoardIds));
    te("search");
  }

  // Pieces filter: compute matching board IDs server-side BEFORE pagination
  // Scope to boards already matching where.id if set
  if (pieces) {
    t("pieces");
    const pieceBounds = { "1-2": [1, 2], "3-5": [3, 5], "6+": [6, 999] }[pieces];
    if (pieceBounds) {
      const [minPieces, maxPieces] = pieceBounds;
      // Build item where clause scoped to current where.id
      const itemWhere = { board: { shop, status: { in: ["SHARED", "VOTED"] } } };
      if (where.id?.in) {
        itemWhere.boardId = { in: where.id.in };
      } else if (where.id?.notIn) {
        itemWhere.boardId = { notIn: where.id.notIn };
      }
      const itemCounts = await prisma.boardItem.groupBy({
        by: ["boardId"],
        where: itemWhere,
        _count: { id: true },
      });
      const matchingBoardIds = itemCounts
        .filter((g) => g._count.id >= minPieces && g._count.id <= maxPieces)
        .map((g) => g.boardId);
      where.id = intersectIdFilter(where.id, matchingBoardIds);
      te("pieces");
    }
  }

  // Voter count filter: compute matching board IDs server-side BEFORE pagination
  if (voterCount) {
    t("voterCount");
    const voterBounds = { "1": [1, 1], "2-3": [2, 3], "4-5": [4, 5] }[voterCount];
    if (voterBounds) {
      const [minVoters, maxVoters] = voterBounds;
      // Build voter where clause scoped to current where.id
      const voterWhere = { board: { shop, status: { in: ["SHARED", "VOTED"] } } };
      if (where.id?.in) {
        voterWhere.boardId = { in: where.id.in };
      } else if (where.id?.notIn) {
        voterWhere.boardId = { notIn: where.id.notIn };
      }
      const voterCounts = await prisma.voter.groupBy({
        by: ["boardId"],
        where: voterWhere,
        _count: { id: true },
      });
      const matchingBoardIds = voterCounts
        .filter((g) => g._count.id >= minVoters && g._count.id <= maxVoters)
        .map((g) => g.boardId);
      where.id = intersectIdFilter(where.id, matchingBoardIds);
      te("voterCount");
    }
  }

  // Determine sort strategy
  t("main-query");
  const sortOpt = SORT_OPTIONS[sort] || SORT_OPTIONS.newest;
  const needsComputedSort = ["pieces_desc", "loved_desc", "value_desc"].includes(sort);

  let boards;
  let total;

  if (needsComputedSort) {
    // For computed sorts, get ALL matching board IDs, compute sort values, then paginate
    const allIds = await prisma.board.findMany({
      where,
      select: { id: true, sharedAt: true },
    });
    total = allIds.length;

    if (total === 0) {
      return { boards: [], total: 0, page: 1, pageCount: 0 };
    }

    // Compute sort values for all boards
    const boardIdList = allIds.map((b) => b.id);
    const sharedAtMap = new Map(allIds.map((b) => [b.id, b.sharedAt]));

    let sortedIds;
    if (sort === "pieces_desc") {
      // Count items per board
      const itemCounts = await prisma.boardItem.groupBy({
        by: ["boardId"],
        where: { boardId: { in: boardIdList } },
        _count: { id: true },
      });
      const countMap = new Map(itemCounts.map((g) => [g.boardId, g._count.id]));
      sortedIds = boardIdList.sort((a, b) => {
        const diff = (countMap.get(b) || 0) - (countMap.get(a) || 0);
        if (diff !== 0) return diff;
        return (sharedAtMap.get(b) || 0) - (sharedAtMap.get(a) || 0); // tie-break
      });
    } else if (sort === "loved_desc") {
      // Count LOVE votes per board
      const loveCounts = await prisma.vote.groupBy({
        by: ["boardItemId"],
        where: {
          verdict: "LOVE",
          boardItem: { boardId: { in: boardIdList } },
        },
      });
      // Map boardItemId to boardId
      const itemToBoard = await prisma.boardItem.findMany({
        where: { id: { in: loveCounts.map((v) => v.boardItemId) } },
        select: { id: true, boardId: true },
      });
      const itemToBoardMap = new Map(itemToBoard.map((i) => [i.id, i.boardId]));
      const loveMap = new Map();
      for (const v of loveCounts) {
        const bid = itemToBoardMap.get(v.boardItemId);
        if (bid) loveMap.set(bid, (loveMap.get(bid) || 0) + 1);
      }
      sortedIds = boardIdList.sort((a, b) => {
        const diff = (loveMap.get(b) || 0) - (loveMap.get(a) || 0);
        if (diff !== 0) return diff;
        return (sharedAtMap.get(b) || 0) - (sharedAtMap.get(a) || 0);
      });
    } else if (sort === "value_desc") {
      // Get order values
      const orderEvents = await prisma.analyticsEvent.findMany({
        where: {
          shop,
          type: "order_from_board",
          boardId: { in: boardIdList },
        },
        select: { boardId: true, valueCents: true },
      });
      const valueMap = new Map();
      for (const e of orderEvents) {
        if (e.boardId) valueMap.set(e.boardId, e.valueCents || 0);
      }
      sortedIds = boardIdList.sort((a, b) => {
        const diff = (valueMap.get(b) || 0) - (valueMap.get(a) || 0);
        if (diff !== 0) return diff;
        return (sharedAtMap.get(b) || 0) - (sharedAtMap.get(a) || 0);
      });
    }

    // Paginate the sorted IDs
    const skip = (page - 1) * PAGE_SIZE;
    const pageIds = sortedIds.slice(skip, skip + PAGE_SIZE);

    // Fetch the boards in the sorted order
    const boardsUnsorted = await prisma.board.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        customerId: true,
        ownerFirstName: true,
        hidePrices: true,
        status: true,
        sharedAt: true,
        expiresAt: true,
        voters: {
          select: {
            id: true,
            firstName: true,
            avatarKey: true,
            kind: true,
            openedAt: true,
            completedAt: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            votes: { select: { verdict: true, reason: true, reasonText: true } },
          },
        },
      },
    });

    // Restore sort order
    const boardMap = new Map(boardsUnsorted.map((b) => [b.id, b]));
    boards = pageIds.map((id) => boardMap.get(id)).filter(Boolean);
  } else {
    // Standard Prisma sort
    total = await prisma.board.count({ where });

    if (total === 0) {
      return { boards: [], total: 0, page: 1, pageCount: 0 };
    }

    const skip = (page - 1) * PAGE_SIZE;

    // Build orderBy
    let orderBy;
    if (sort === "pieces_desc") {
      orderBy = [{ items: { _count: "desc" } }, { sharedAt: "desc" }];
    } else if (sortOpt.field === "sharedAt" || sortOpt.field === "expiresAt") {
      orderBy = { [sortOpt.field]: sortOpt.dir };
    } else {
      orderBy = { sharedAt: "desc" };
    }

    boards = await prisma.board.findMany({
      where,
      orderBy,
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        customerId: true,
        ownerFirstName: true,
        hidePrices: true,
        status: true,
        sharedAt: true,
        expiresAt: true,
        voters: {
          select: {
            id: true,
            firstName: true,
            avatarKey: true,
            kind: true,
            openedAt: true,
            completedAt: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            votes: { select: { verdict: true, reason: true, reasonText: true } },
          },
        },
      },
    });
  }
  te("main-query");

  // For "voted" status filter, post-filter to ensure ALL personal voters are done
  if (status === "voted" || view === "voted_no_order") {
    boards = boards.filter((b) => {
      const personal = b.voters.filter((v) => v.kind === "PERSONAL");
      return personal.length > 0 && personal.every((v) => v.completedAt);
    });
  }

  // Recalculate total after post-filters
  // shortcut: only if filters were applied that change the count
  const postFilterApplied = status === "voted" || view === "voted_no_order";
  if (postFilterApplied) {
    // For accurate pagination we'd need to re-query, but that's expensive.
    // For now, show what we have. The count may be slightly off.
  }

  const pageCount = Math.ceil(total / PAGE_SIZE);

  // Get order events for these boards
  t("events");
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

  // Get share channels
  const channelEvents = await prisma.analyticsEvent.findMany({
    where: {
      shop,
      type: "share_channel",
      boardId: { in: boardIds },
    },
    select: { boardId: true, meta: true },
  });
  te("events");

  // Map by boardId
  const orderMap = new Map();
  for (const e of orderEvents) {
    if (e.boardId) orderMap.set(e.boardId, e);
  }
  const channelMap = new Map();
  for (const e of channelEvents) {
    if (e.boardId && e.meta?.channel) {
      channelMap.set(e.boardId, e.meta.channel);
    }
  }

  // Build result
  const result = boards.map((b) => {
    const order = orderMap.get(b.id);
    const voteCounts = getVoteCounts(b.items);
    const { status: statusText, tone: statusTone } = getBoardStatus(b, !!order);
    const votersDisplay = formatVotersForDisplay(b.voters);
    const voterSummary = getVoterSummaryText(b.voters);

    return {
      id: b.id,
      shopperCustomerId: b.customerId,
      shopperFirstName: b.ownerFirstName,
      pieceCount: b.items.length,
      loveCount: voteCounts.love,
      maybeCount: voteCounts.maybe,
      passCount: voteCounts.pass,
      status: statusText,
      statusTone,
      sharedAt: b.sharedAt,
      expiresAt: b.expiresAt,
      hidePrices: b.hidePrices,
      channel: channelMap.get(b.id) || null,
      voters: votersDisplay,
      voterCount: b.voters.length,
      voterSummary,
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
        reason: i.votes[0]?.reason || null,
        reasonText: i.votes[0]?.reasonText || null,
      })),
    };
  });

  return {
    boards: result,
    total,
    page,
    pageCount,
  };
}

/**
 * Helper to intersect ID filters.
 * @param {object|undefined} existing - Existing where.id filter
 * @param {string[]} newIds - New IDs to intersect with
 * @returns {object} Updated where.id filter
 */
function intersectIdFilter(existing, newIds) {
  const newIdSet = new Set(newIds);
  if (!existing) {
    return { in: newIds };
  }
  if (existing.in) {
    return { in: existing.in.filter((id) => newIdSet.has(id)) };
  }
  if (existing.notIn) {
    return { in: newIds.filter((id) => !existing.notIn.includes(id)) };
  }
  return { in: newIds };
}

// Product title search cache (60s TTL)
const productSearchCache = new Map();
const PRODUCT_CACHE_TTL = 60 * 1000;

/**
 * Search products by title using Admin GraphQL.
 * Results cached 60s per shop+term.
 * @param {object} admin - Shopify Admin API client
 * @param {string} shop
 * @param {string} term - Search term
 * @returns {Promise<string[]>} Array of product GIDs
 */
async function searchProductsByTitle(admin, shop, term) {
  const cacheKey = `${shop}:${term.toLowerCase()}`;
  const cached = productSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < PRODUCT_CACHE_TTL) {
    return cached.ids;
  }

  try {
    // Escape special characters for Shopify query
    const escapedTerm = term.replace(/[\\:"]/g, "\\$&");
    const response = await admin.graphql(
      `query SearchProducts($query: String!) {
        products(first: 50, query: $query) {
          nodes { id }
        }
      }`,
      { variables: { query: `title:*${escapedTerm}*` } }
    );

    const json = await response.json();
    const ids = (json.data?.products?.nodes || []).map((n) => n.id);

    productSearchCache.set(cacheKey, { ids, time: Date.now() });
    return ids;
  } catch (err) {
    log.warn("audit.product_search_failed", { term, error: err.message });
    return [];
  }
}

/**
 * Get a single board by ID for the detail page.
 * @param {string} shop
 * @param {string} boardId
 * @returns {Promise<object|null>}
 */
export async function getBoardDetail(shop, boardId) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, shop, status: { in: ["SHARED", "VOTED"] } },
    select: {
      id: true,
      customerId: true,
      ownerFirstName: true,
      hidePrices: true,
      groupToken: true,
      status: true,
      sharedAt: true,
      notifiedAt: true,
      expiresAt: true,
      voters: {
        select: {
          id: true,
          firstName: true,
          avatarKey: true,
          kind: true,
          openedAt: true,
          completedAt: true,
        },
      },
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          productId: true,
          variantId: true,
          votes: {
            select: {
              voterId: true,
              verdict: true,
              reason: true,
              reasonText: true,
            },
          },
        },
      },
    },
  });

  if (!board) return null;

  // Get analytics events for timeline
  const events = await prisma.analyticsEvent.findMany({
    where: { shop, boardId },
    orderBy: { createdAt: "desc" },
    select: { type: true, createdAt: true, meta: true, valueCents: true, currencyCode: true, orderId: true, customerId: true },
  });

  // Get order event
  const orderEvent = events.find((e) => e.type === "order_from_board");
  const channelEvent = events.find((e) => e.type === "share_channel");

  // Use shared metrics functions
  const voteCounts = getVoteCounts(board.items);
  const { status: statusText, tone: statusTone } = getBoardStatus(board, !!orderEvent);
  const votersDisplay = formatVotersForDisplay(board.voters);
  const voterSummary = getVoterSummaryText(board.voters);

  // Build timeline
  const timeline = [];
  if (board.sharedAt) {
    timeline.push({
      event: "Shared",
      detail: channelEvent?.meta?.channel ? `via ${channelEvent.meta.channel}` : null,
      at: board.sharedAt,
    });
  }
  // Add voter events to timeline
  for (const v of board.voters) {
    if (v.openedAt) {
      timeline.push({ event: `${v.firstName} opened`, at: v.openedAt });
    }
    if (v.completedAt) {
      timeline.push({ event: `${v.firstName} finished voting`, at: v.completedAt });
    }
  }
  // Check if all personal voters done for "Voting done" event
  const personalVoters = board.voters.filter((v) => v.kind === "PERSONAL");
  const allPersonalDone = personalVoters.length > 0 &&
    personalVoters.every((v) => v.completedAt);
  if (allPersonalDone && board.notifiedAt) {
    timeline.push({ event: "Email sent", at: board.notifiedAt });
  }
  const resultsOpened = events.find((e) => e.type === "results_opened");
  if (resultsOpened) {
    timeline.push({ event: "Results opened", at: resultsOpened.createdAt });
  }
  const addedToCart = events.find((e) => e.type === "results_add_loved");
  if (addedToCart) {
    timeline.push({ event: "Added to cart", at: addedToCart.createdAt });
  }
  if (orderEvent) {
    timeline.push({
      event: "Order placed",
      detail: orderEvent.meta?.orderName,
      at: orderEvent.createdAt,
    });
  }
  // Sort newest first
  timeline.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    id: board.id,
    shopperCustomerId: board.customerId,
    shopperFirstName: board.ownerFirstName,
    pieceCount: board.items.length,
    loveCount: voteCounts.love,
    maybeCount: voteCounts.maybe,
    passCount: voteCounts.pass,
    status: statusText,
    statusTone,
    sharedAt: board.sharedAt,
    expiresAt: board.expiresAt,
    hidePrices: board.hidePrices,
    channel: channelEvent?.meta?.channel || null,
    voters: votersDisplay,
    voterCount: board.voters.length,
    voterSummary,
    // backward compat: partnerFirstName from first voter
    partnerFirstName: board.voters[0]?.firstName || null,
    groupToken: board.groupToken || null,
    order: orderEvent
      ? {
          orderId: orderEvent.orderId || orderEvent.meta?.orderId || null,
          orderName: orderEvent.meta?.orderName || "Order",
          customerId: orderEvent.customerId || orderEvent.meta?.customerId || null,
          valueCents: orderEvent.valueCents || 0,
          currencyCode: orderEvent.currencyCode || "USD",
        }
      : null,
    // Build voter map for item votes
    items: board.items.map((i) => {
      // Map votes to voter info
      const voterMap = new Map(board.voters.map((v) => [v.id, v]));
      const votesWithVoter = i.votes.map((vote) => {
        const voter = voterMap.get(vote.voterId);
        return {
          voterId: vote.voterId,
          voterFirstName: voter?.firstName || "Unknown",
          voterAvatarKey: voter?.avatarKey || "sam",
          verdict: vote.verdict,
          reason: vote.reason,
          reasonText: vote.reasonText,
        };
      });
      return {
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        // First vote for backward compat
        verdict: i.votes[0]?.verdict || null,
        reason: i.votes[0]?.reason || null,
        reasonText: i.votes[0]?.reasonText || null,
        // All votes with voter info
        votes: votesWithVoter,
      };
    }),
    timeline,
  };
}

/**
 * Get product titles for search/filter suggestions.
 * Returns distinct product IDs and titles from boards in this shop.
 * @param {string} shop
 * @param {object} admin - Shopify Admin API client
 * @returns {Promise<Array<{ id: string, title: string }>>}
 */
export async function getProductsOnBoards(shop, admin) {
  const items = await prisma.boardItem.findMany({
    where: { board: { shop, status: { in: ["SHARED", "VOTED"] } } },
    select: { productId: true },
    distinct: ["productId"],
    take: 100,
  });

  const productIds = items.map((i) => i.productId);
  const { map: titleMap } = await fetchProductTitles(admin, productIds);

  return productIds.map((id) => ({
    id,
    title: titleMap.get(id) || "Product",
  }));
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
 * Fetch variant data from Admin API (title, product title, image).
 * @param {object} admin - Shopify Admin API client
 * @param {string[]} variantIds - Array of variant GIDs
 * @returns {Promise<{ map: Map<string, object>, ok: boolean }>}
 */
export async function fetchVariantData(admin, variantIds) {
  if (!variantIds.length) return { map: new Map(), ok: true };

  try {
    const response = await admin.graphql(
      `query GetVariantData($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            image { url(transform: { maxWidth: 60, maxHeight: 60 }) }
            product { title featuredImage { url(transform: { maxWidth: 60, maxHeight: 60 }) } }
          }
        }
      }`,
      { variables: { ids: variantIds } }
    );

    const json = await response.json();

    if (json.errors) {
      log.warn("audit.variant_data_failed", { count: variantIds.length });
      return { map: new Map(), ok: false };
    }

    const dataMap = new Map();
    for (const node of json.data?.nodes || []) {
      if (node?.id) {
        dataMap.set(node.id, {
          variantTitle: node.title || "Default Title",
          productTitle: node.product?.title || "Product",
          imageUrl: node.image?.url || node.product?.featuredImage?.url || null,
        });
      }
    }

    return { map: dataMap, ok: true };
  } catch {
    log.warn("audit.variant_data_failed", { count: variantIds.length });
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
