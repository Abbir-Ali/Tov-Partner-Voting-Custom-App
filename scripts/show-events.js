#!/usr/bin/env node
/* eslint-env node */
/**
 * Quick event viewer for development.
 * Usage: npm run events
 * Shows counts per type for the last 24 hours and the last 10 events.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // Get the first shop from DB
  const settings = await db.shopSettings.findFirst({
    select: { shop: true },
  });

  if (!settings) {
    console.log("No shop found in database.");
    process.exit(0);
  }

  const shop = settings.shop;
  console.log(`\nEvents for shop: ${shop}\n`);

  // Get counts by type for last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const counts = await db.analyticsEvent.groupBy({
    by: ["type"],
    where: {
      shop,
      createdAt: { gte: since },
    },
    _count: true,
  });

  console.log("Counts (last 24h):");
  console.log("─".repeat(30));
  if (counts.length === 0) {
    console.log("  (none)");
  } else {
    for (const row of counts.sort((a, b) => b._count - a._count)) {
      console.log(`  ${row.type.padEnd(20)} ${row._count}`);
    }
  }

  // Get last 10 events
  const recent = await db.analyticsEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      type: true,
      createdAt: true,
      boardId: true,
      valueCents: true,
    },
  });

  console.log("\nLast 10 events:");
  console.log("─".repeat(60));
  if (recent.length === 0) {
    console.log("  (none)");
  } else {
    for (const e of recent) {
      const time = e.createdAt.toISOString().replace("T", " ").slice(0, 19);
      const val = e.valueCents ? ` $${(e.valueCents / 100).toFixed(2)}` : "";
      const bid = e.boardId ? ` ${e.boardId.slice(0, 8)}` : "";
      console.log(`  ${time}  ${e.type.padEnd(18)}${val}${bid}`);
    }
  }

  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
