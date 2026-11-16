#!/usr/bin/env node
/* eslint-env node */
/**
 * Seed realistic dashboard data for dev testing.
 * Creates analytics events with meta.seed = true.
 * Use --clear to delete only seed rows.
 *
 * Usage:
 *   npm run seed:dashboard         # Insert seed data
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

async function seedData(shop, products) {
  console.log(`Seeding dashboard data for shop: ${shop}`);

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

  // Create 25 boards spread over 60 days
  const boards = [];
  let seedNum = 1;
  for (let i = 0; i < 25; i++) {
    const sharedAt = randomDate(60);
    const hasVoted = Math.random() > 0.3; // 70% have votes
    const hasOrdered = hasVoted && Math.random() > 0.5; // 50% of voted boards ordered

    const board = await prisma.board.create({
      data: {
        id: `seed-board-${randomId()}`,
        shop,
        shareToken: `share-${randomId()}`,
        ownerToken: `owner-${randomId()}`,
        creatorKey: `creator-${randomId()}`,
        name: `Seed Board ${i + 1}`,
        status: hasVoted ? "VOTED" : "SHARED",
        sharedAt,
        votingCompletedAt: hasVoted ? new Date(sharedAt.getTime() + 2 * 60 * 60 * 1000) : null,
        partnerOpenedAt: hasVoted ? new Date(sharedAt.getTime() + 30 * 60 * 1000) : null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    boards.push({ board, sharedAt, hasVoted, hasOrdered, seedNum: seedNum++ });

    // Add 2-5 items per board
    const itemCount = 2 + Math.floor(Math.random() * 4);
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
            voterName: "Partner",
          },
        });
      }
    }
  }

  // Create analytics events
  const events = [];

  // Button impressions (150)
  for (let i = 0; i < 150; i++) {
    events.push({
      shop,
      type: "button_impression",
      visitorHash: `visitor-${Math.floor(Math.random() * 80)}`,
      createdAt: randomDate(60),
      meta: { seed: true },
    });
  }

  // Button saves (60)
  for (let i = 0; i < 60; i++) {
    events.push({
      shop,
      type: "button_save",
      visitorHash: `visitor-${Math.floor(Math.random() * 60)}`,
      createdAt: randomDate(60),
      meta: { seed: true },
    });
  }

  // Share opens (35)
  for (let i = 0; i < 35; i++) {
    events.push({
      shop,
      type: "share_open",
      visitorHash: `visitor-${Math.floor(Math.random() * 35)}`,
      createdAt: randomDate(60),
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

  // Insert all events
  await prisma.analyticsEvent.createMany({ data: events });
  console.log(`Created ${events.length} seed analytics events.`);
  console.log(`Created ${boards.length} seed boards with items and votes.`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClear = args.includes("--clear");

  try {
    const shop = await getShop();
    console.log(`Using shop: ${shop}`);

    if (shouldClear) {
      await clearSeedData(shop);
    } else {
      const products = await getProducts(shop);
      await seedData(shop, products);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
