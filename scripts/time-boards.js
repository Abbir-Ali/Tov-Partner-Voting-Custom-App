#!/usr/bin/env node
/* eslint-env node */
/**
 * Timing script for getAuditBoards performance.
 * Run: PVB_TIMING=1 npm run time:boards
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

// Set timing flag
process.env.PVB_TIMING = "1";

const prisma = new PrismaClient();

// Stub admin client that returns empty products
const stubAdmin = {
  graphql: async () => ({
    json: async () => ({ data: { products: { nodes: [] } } }),
  }),
};

// Dynamic import after env is set
const { getAuditBoards } = await import("../app/services/audit.server.js");

async function time(label, fn) {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`${label}: ${ms}ms (${result.total} boards)`);
  return { label, ms, total: result.total };
}

async function run() {
  // Get the shop from an existing board
  const sample = await prisma.board.findFirst({ select: { shop: true } });
  if (!sample) {
    console.log("No boards in database. Run seed:dashboard first.");
    process.exit(1);
  }
  const shop = sample.shop;
  console.log(`\nTiming getAuditBoards for shop: ${shop}\n`);

  const tests = [
    { name: "Default view", params: {} },
    { name: "Most loved", params: { sort: "loved_desc" } },
    { name: "Order value", params: { sort: "value_desc" } },
    { name: "Combined filters", params: { status: "voted", pieces: "3-5", q: "sofa" } },
  ];

  console.log("=== COLD RUN ===");
  const cold = [];
  for (const t of tests) {
    const result = await time(t.name, () => getAuditBoards(shop, t.params, stubAdmin));
    cold.push(result);
  }

  console.log("\n=== WARM RUN ===");
  const warm = [];
  for (const t of tests) {
    const result = await time(t.name, () => getAuditBoards(shop, t.params, stubAdmin));
    warm.push(result);
  }

  console.log("\n=== SUMMARY ===");
  console.log("Test                  | Cold   | Warm");
  console.log("----------------------|--------|------");
  for (let i = 0; i < tests.length; i++) {
    const name = tests[i].name.padEnd(20);
    console.log(`${name} | ${String(cold[i].ms).padStart(4)}ms | ${String(warm[i].ms).padStart(4)}ms`);
  }

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
