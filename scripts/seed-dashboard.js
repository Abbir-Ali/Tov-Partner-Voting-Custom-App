#!/usr/bin/env node
/* eslint-env node */
/**
 * Seed realistic dashboard data for dev testing.
 * Creates analytics events with meta.seed = true.
 * Use --clear to delete only seed rows.
 * Use --boards N to seed N boards (default 25).
 *
 * Usage:
 *   npm run seed:dashboard         # Insert seed data (25 boards)
 *   npm run seed:dashboard -- --boards 1000  # Insert 1000 boards
 *   npm run seed:dashboard:clear   # Remove seed data only
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

// Refuse to run in production
if (process.env.NODE_ENV === "production") {
  console.error("Error: seed-dashboard.js cannot run in production.");
  process.exit(1);
}

const prisma = new PrismaClient();

const CHANNELS = ["whatsapp", "email", "sms", "copy", "native"];
const PASS_REASONS = ["color", "size", "price", "style", "material", "comfort"];
const MAYBE_REASONS = ["another_color", "different_size", "lower_price", "in_person"];
const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery",
  "Reese", "Skyler", "Jamie", "Drew", "Sage", "Blake", "Cameron", "Hayden",
  "Hamza", "Tristine", "Sarah", "Michael", "Emma", "James", "Olivia", "William",
];

function randomId() {
  return crypto.randomBytes(12).toString("hex");
}

function randomDate(daysAgo) {
  const now = Date.now();
  const offset = Math.random() * daysAgo * 24 * 60 * 60 * 1000;
  return new Date(now - offset);
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get shop from env or most recent offline session.
 */
async function getShop() {
  if (process.env.SEED_SHOP) {
    return process.env.SEED_SHOP;
  }
  const session = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { id: "desc" },
    select: { shop: true },
  });
  if (!session) {
    console.error("Error: No offline session found. Set SEED_SHOP env var.");
    process.exit(1);
  }
  return session.shop;
}

/**
 * Get real product/variant pairs from existing board items, or fallback.
 */
async function getProducts(shop) {
  const items = await prisma.boardItem.findMany({
    where: {
      board: { shop },
      NOT: { board: { id: { startsWith: "seed-board-" } } },
    },
    distinct: ["productId", "variantId"],
    take: 6,
    select: { productId: true, variantId: true },
  });

  if (items.length > 0) {
    return items;
  }

  console.log("Note: No existing board items. Using fake GIDs; titles will show 'Product'.");
  return [
    { productId: "gid://shopify/Product/8001", variantId: "gid://shopify/ProductVariant/80011" },
    { productId: "gid://shopify/Product/8002", variantId: "gid://shopify/ProductVariant/80021" },
    { productId: "gid://shopify/Product/8003", variantId: "gid://shopify/ProductVariant/80031" },
    { productId: "gid://shopify/Product/8004", variantId: "gid://shopify/ProductVariant/80041" },
    { productId: "gid://shopify/Product/8005", variantId: "gid://shopify/ProductVariant/80051" },
    { productId: "gid://shopify/Product/8006", variantId: "gid://shopify/ProductVariant/80061" },
  ];
}

async function clearSeedData(shop) {
  // Delete seeded analytics events
  const eventResult = await prisma.analyticsEvent.deleteMany({
    where: {
      shop,
      meta: { path: ["seed"], equals: true },
    },
  });
  console.log(`Deleted ${eventResult.count} seed analytics events.`);

  // Delete seeded boards by id prefix (cascade deletes items and votes)
  const boardResult = await prisma.board.deleteMany({
    where: {
      shop,
      id: { startsWith: "seed-board-" },
    },
  });
  console.log(`Deleted ${boardResult.count} seed boards.`);
}

async function seedData(shop, products, boardCount) {
  console.log(`Seeding dashboard data for shop: ${shop} (${boardCount} boards)`);
  const startTime = Date.now();

  // Track used order IDs to ensure uniqueness
  const usedOrderIds = new Set();
  function uniqueOrderId() {
    let id;
    do {
      id = `gid://shopify/Order/99${crypto.randomBytes(5).toString("hex")}`;
    } while (usedOrderIds.has(id));
    usedOrderIds.add(id);
    return id;
  }

  // Create boards spread over 90 days
  const boards = [];
  let seedNum = 1;
  for (let i = 0; i < boardCount; i++) {
    const sharedAt = randomDate(90);
    const hasVoted = Math.random() > 0.3; // 70% have votes
    const hasOrdered = hasVoted && Math.random() > 0.5; // 50% of voted boards ordered
    const isExpiringSoon = !hasVoted && Math.random() > 0.9; // 10% of unvoted expiring soon

    const ownerFirstName = randomChoice(FIRST_NAMES);
    const partnerFirstName = randomChoice(FIRST_NAMES);

    // Expiry: 30 days from share, or 2 days from now if expiring soon
    let expiresAt = new Date(sharedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (isExpiringSoon) {
      expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    }

    const board = await prisma.board.create({
      data: {
        id: `seed-board-${randomId()}`,
        shop,
        shareToken: `share-${randomId()}`,
        ownerToken: `owner-${randomId()}`,
        creatorKey: `creator-${randomId()}`,
        name: `Seed Board ${i + 1}`,
        ownerFirstName,
        partnerFirstName,
        status: hasVoted ? "VOTED" : "SHARED",
        sharedAt,
        votingCompletedAt: hasVoted ? new Date(sharedAt.getTime() + 2 * 60 * 60 * 1000) : null,
        partnerOpenedAt: hasVoted ? new Date(sharedAt.getTime() + 30 * 60 * 1000) : null,
        expiresAt,
      },
    });

    boards.push({ board, sharedAt, hasVoted, hasOrdered, seedNum: seedNum++ });

    // Add 2-12 items per board
    const itemCount = 2 + Math.floor(Math.random() * 11);
    const shuffled = [...products].sort(() => Math.random() - 0.5);
    for (let j = 0; j < itemCount && j < shuffled.length; j++) {
      const item = await prisma.boardItem.create({
        data: {
          id: `seed-item-${randomId()}`,
          boardId: board.id,
          productId: shuffled[j].productId,
          variantId: shuffled[j].variantId,
          position: j,
        },
      });

      // Add vote if board was voted
      if (hasVoted) {
        // Weight toward LOVE for realism
        const verdict = Math.random() > 0.4 ? "LOVE" : randomChoice(["MAYBE", "PASS"]);
        // 60% of MAYBE/PASS votes get a reason
        let reason = null;
        if (verdict === "PASS" && Math.random() < 0.6) {
          reason = randomChoice(PASS_REASONS);
        } else if (verdict === "MAYBE" && Math.random() < 0.6) {
          reason = randomChoice(MAYBE_REASONS);
        }
        await prisma.vote.create({
          data: {
            id: `seed-vote-${randomId()}`,
            boardItemId: item.id,
            verdict,
            reason,
            voterName: partnerFirstName,
          },
        });
      }
    }

    // Progress logging for large seeds
    if (boardCount >= 100 && (i + 1) % 100 === 0) {
      console.log(`  Created ${i + 1}/${boardCount} boards...`);
    }
  }

  // Create analytics events
  const events = [];

  // Button impressions (scale with board count)
  const impressionCount = Math.min(boardCount * 6, 1000);
  for (let i = 0; i < impressionCount; i++) {
    events.push({
      shop,
      type: "button_impression",
      visitorHash: `visitor-${Math.floor(Math.random() * (boardCount * 3))}`,
      createdAt: randomDate(90),
      meta: { seed: true },
    });
  }

  // Button saves (scale with board count)
  const saveCount = Math.min(boardCount * 2.4, 400);
  for (let i = 0; i < saveCount; i++) {
    events.push({
      shop,
      type: "button_save",
      visitorHash: `visitor-${Math.floor(Math.random() * (boardCount * 2))}`,
      createdAt: randomDate(90),
      meta: { seed: true },
    });
  }

  // Share opens (scale with board count)
  const shareOpenCount = Math.min(boardCount * 1.4, 250);
  for (let i = 0; i < shareOpenCount; i++) {
    events.push({
      shop,
      type: "share_open",
      visitorHash: `visitor-${Math.floor(Math.random() * boardCount)}`,
      createdAt: randomDate(90),
      meta: { seed: true },
    });
  }

  // Board and funnel events for each board
  for (const { board, sharedAt, hasVoted, hasOrdered, seedNum: sn } of boards) {
    // board_shared
    events.push({
      shop,
      type: "board_shared",
      boardId: board.id,
      createdAt: sharedAt,
      meta: { seed: true },
    });

    // share_channel
    events.push({
      shop,
      type: "share_channel",
      boardId: board.id,
      createdAt: new Date(sharedAt.getTime() + 1000),
      meta: { seed: true, channel: randomChoice(CHANNELS) },
    });

    // partner_opened (80%)
    if (Math.random() > 0.2) {
      events.push({
        shop,
        type: "partner_opened",
        boardId: board.id,
        createdAt: new Date(sharedAt.getTime() + 30 * 60 * 1000),
        meta: { seed: true },
      });
    }

    // vote_completed
    if (hasVoted) {
      events.push({
        shop,
        type: "vote_completed",
        boardId: board.id,
        createdAt: new Date(sharedAt.getTime() + 2 * 60 * 60 * 1000),
        meta: { seed: true },
      });

      // results_opened (always after vote)
      events.push({
        shop,
        type: "results_opened",
        boardId: board.id,
        createdAt: new Date(sharedAt.getTime() + 3 * 60 * 60 * 1000),
        meta: { seed: true },
      });

      // results_add_loved (60% of voted boards)
      if (Math.random() > 0.4) {
        events.push({
          shop,
          type: "results_add_loved",
          boardId: board.id,
          createdAt: new Date(sharedAt.getTime() + 3.5 * 60 * 60 * 1000),
          meta: { seed: true },
        });
      }
    }

    // order_from_board
    if (hasOrdered) {
      const orderId = uniqueOrderId();
      const valueCents = 15000 + Math.floor(Math.random() * 30000);
      events.push({
        shop,
        type: "order_from_board",
        boardId: board.id,
        orderId,
        valueCents,
        currencyCode: "USD",
        customerId: null,
        createdAt: new Date(sharedAt.getTime() + 4 * 60 * 60 * 1000),
        meta: { seed: true, orderName: `#S${sn}` },
      });
    }
  }

  // Insert all events in batches to avoid memory issues
  const BATCH_SIZE = 500;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await prisma.analyticsEvent.createMany({ data: batch });
  }

  const elapsed = Date.now() - startTime;
  console.log(`Created ${events.length} seed analytics events.`);
  console.log(`Created ${boards.length} seed boards with items and votes.`);
  console.log(`Seeding completed in ${elapsed}ms.`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClear = args.includes("--clear");

  // Parse --boards N
  const boardsIndex = args.indexOf("--boards");
  let boardCount = 25;
  if (boardsIndex !== -1 && args[boardsIndex + 1]) {
    boardCount = parseInt(args[boardsIndex + 1], 10);
    if (isNaN(boardCount) || boardCount < 1) {
      console.error("Error: --boards must be a positive number.");
      process.exit(1);
    }
  }

  try {
    const shop = await getShop();
    console.log(`Using shop: ${shop}`);

    if (shouldClear) {
      await clearSeedData(shop);
    } else {
      const products = await getProducts(shop);
      await seedData(shop, products, boardCount);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
