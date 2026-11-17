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
import { pickAvatar } from "../app/models/avatars.shared.js";

if (process.env.NODE_ENV === "production") {
  console.error("Error: seed-group.js cannot run in production.");
  process.exit(1);
}

const prisma = new PrismaClient();
const SEED_EMAIL = "seed-group@example.com";

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
  // Try existing board items first
  const items = await prisma.boardItem.findMany({
    where: {
      board: { shop },
      NOT: { board: { ownerEmail: SEED_EMAIL } },
    },
    distinct: ["productId", "variantId"],
    take: 4,
    select: { productId: true, variantId: true },
  });

  if (items.length >= 4) {
    return items.slice(0, 4);
  }

  // Fetch real products from Admin API
  console.log("Note: Not enough board items. Fetching real products from Admin API.");

  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    select: { accessToken: true },
  });

  if (!session?.accessToken) {
    console.error("Error: No offline session with access token found for", shop);
    process.exit(1);
  }

  const query = `{
    products(first: 10, query: "status:active") {
      nodes {
        id
        variants(first: 1) {
          nodes {
            id
            availableForSale
          }
        }
      }
    }
  }`;

  const response = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    console.error("Error: Admin API request failed:", response.status, response.statusText);
    process.exit(1);
  }

  const json = await response.json();

  if (json.errors) {
    console.error("Error: GraphQL errors:", JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }

  const products = json.data?.products?.nodes || [];
  const available = products
    .filter((p) => p.variants?.nodes?.[0]?.availableForSale)
    .slice(0, 4)
    .map((p) => ({
      productId: p.id,
      variantId: p.variants.nodes[0].id,
    }));

  if (available.length < 4) {
    console.error("Error: Found only", available.length, "active products with available variants. Need 4.");
    process.exit(1);
  }

  return available;
}

async function clearSeedData(shop) {
  const result = await prisma.board.deleteMany({
    where: {
      shop,
      ownerEmail: SEED_EMAIL,
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

  // Helper to create voters with unique avatars
  function createVoterData(names, boardIdSeed) {
    const usedAvatars = [];
    return names.map((name) => {
      const avatarKey = pickAvatar(`${boardIdSeed}-${name}`, usedAvatars);
      usedAvatars.push(avatarKey);
      return { token: newToken(), firstName: name, kind: "PERSONAL", avatarKey };
    });
  }

  // Board 1: Living Room Ideas (3 personal voters + group link)
  const board1VoterData = createVoterData(["Alex", "Zaid", "Mia"], "board1");
  const board1 = await prisma.board.create({
    data: {
      shop,
      name: "Living Room Ideas",
      ownerFirstName: "Sara",
      ownerEmail: SEED_EMAIL,
      creatorKey: creatorKey(shop, SEED_EMAIL),
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
        create: board1VoterData,
      },
    },
    include: { voters: true },
  });

  console.log("Board 1: Living Room Ideas (hidePrices: false)");
  console.log(`  Results: ${baseUrl}/results/${board1.ownerToken}`);
  console.log(`  Group:   ${baseUrl}/${board1.groupToken}`);
  for (const v of board1.voters) {
    console.log(`  ${v.firstName}: ${baseUrl}/${v.token}`);
  }

  // Board 2: Prices Hidden (2 personal voters)
  const board2VoterData = createVoterData(["Alex", "Zaid"], "board2");
  const board2 = await prisma.board.create({
    data: {
      shop,
      name: "Prices Hidden",
      ownerFirstName: "Sara",
      ownerEmail: SEED_EMAIL,
      creatorKey: creatorKey(shop, SEED_EMAIL),
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
        create: board2VoterData,
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
