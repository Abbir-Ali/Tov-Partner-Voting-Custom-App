#!/usr/bin/env node
/* eslint-env node */
/**
 * Seed group voting test data.
 * Creates boards with multiple voters for testing group features.
 *
 * Usage:
 *   npm run seed:group          # Create seed boards
 *   npm run seed:group -- --clear  # Remove seed boards
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

if (process.env.NODE_ENV === "production") {
  console.error("Error: seed-group.js cannot run in production.");
  process.exit(1);
}

const prisma = new PrismaClient();
const SEED_PREFIX = "[seed-group]";

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function creatorKey(shop, email) {
  return crypto.createHash("sha256").update(`${shop}:${email.toLowerCase()}`).digest("hex");
}

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

async function getProducts(shop) {
  const items = await prisma.boardItem.findMany({
    where: {
      board: { shop },
      NOT: { board: { name: { startsWith: SEED_PREFIX } } },
    },
    distinct: ["productId", "variantId"],
    take: 4,
    select: { productId: true, variantId: true },
  });

  if (items.length >= 4) {
    return items.slice(0, 4);
  }

  console.log("Note: Not enough board items. Using fake GIDs.");
  return [
    { productId: "gid://shopify/Product/8001", variantId: "gid://shopify/ProductVariant/80011" },
    { productId: "gid://shopify/Product/8002", variantId: "gid://shopify/ProductVariant/80021" },
    { productId: "gid://shopify/Product/8003", variantId: "gid://shopify/ProductVariant/80031" },
    { productId: "gid://shopify/Product/8004", variantId: "gid://shopify/ProductVariant/80041" },
  ];
}

async function clearSeedData(shop) {
  const result = await prisma.board.deleteMany({
    where: {
      shop,
      name: { startsWith: SEED_PREFIX },
    },
  });
  console.log(`Deleted ${result.count} seed-group boards.`);
}

async function seedData(shop, products) {
  const shopDomain = shop;
  const baseUrl = `https://${shopDomain}/apps/board`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  console.log(`\nSeeding group test boards for: ${shop}\n`);

  // Board 1: Living Room (3 personal voters + group link)
  const board1 = await prisma.board.create({
    data: {
      shop,
      name: `${SEED_PREFIX} Living Room`,
      ownerFirstName: "Sara",
      ownerEmail: "sara@example.com",
      creatorKey: creatorKey(shop, "sara@example.com"),
      shareToken: newToken(),
      ownerToken: newToken(),
      groupToken: newToken(),
      status: "SHARED",
      sharedAt: now,
      expiresAt,
      maxVoters: 5,
      hidePrices: false,
      items: {
        create: products.map((p, i) => ({
          productId: p.productId,
          variantId: p.variantId,
          position: i,
        })),
      },
      voters: {
        create: [
          { token: newToken(), firstName: "Alex", kind: "PERSONAL" },
          { token: newToken(), firstName: "Zaid", kind: "PERSONAL" },
          { token: newToken(), firstName: "Mia", kind: "PERSONAL" },
        ],
      },
    },
    include: { voters: true },
  });

  console.log("Board 1: Living Room (hidePrices: false)");
  console.log(`  Results: ${baseUrl}/results/${board1.ownerToken}`);
  console.log(`  Group:   ${baseUrl}/${board1.groupToken}`);
  for (const v of board1.voters) {
    console.log(`  ${v.firstName}: ${baseUrl}/${v.token}`);
  }

  // Board 2: Prices Hidden (2 personal voters)
  const board2 = await prisma.board.create({
    data: {
      shop,
      name: `${SEED_PREFIX} Prices Hidden`,
      ownerFirstName: "Sara",
      ownerEmail: "sara@example.com",
      creatorKey: creatorKey(shop, "sara@example.com"),
      shareToken: newToken(),
      ownerToken: newToken(),
      status: "SHARED",
      sharedAt: now,
      expiresAt,
      maxVoters: 5,
      hidePrices: true,
      items: {
        create: products.map((p, i) => ({
          productId: p.productId,
          variantId: p.variantId,
          position: i,
        })),
      },
      voters: {
        create: [
          { token: newToken(), firstName: "Alex", kind: "PERSONAL" },
          { token: newToken(), firstName: "Zaid", kind: "PERSONAL" },
        ],
      },
    },
    include: { voters: true },
  });

  console.log("\nBoard 2: Prices Hidden (hidePrices: true)");
  console.log(`  Results: ${baseUrl}/results/${board2.ownerToken}`);
  for (const v of board2.voters) {
    console.log(`  ${v.firstName}: ${baseUrl}/${v.token}`);
  }

  console.log("\nDone. Open voter links to test voting, results links to see shopper view.");
}

async function main() {
  const args = process.argv.slice(2);
  const clear = args.includes("--clear");

  try {
    const shop = await getShop();

    if (clear) {
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
