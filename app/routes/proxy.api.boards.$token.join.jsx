/**
 * POST /apps/board/api/boards/:token/join
 *
 * Group board join endpoint served via App Proxy.
 * :token is the board groupToken.
 * Body: { firstName: string }
 * Returns: { voterToken: string } or { error: { code: string } }
 */

import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";
import { getBoardByGroupToken, joinGroupBoard, validateVoterName } from "../models/voter.server.js";
import { VOTE_ERRORS } from "../models/vote.shared.js";
import { log } from "../utils/log.server.js";
import db from "../db.server.js";

const MAX_BODY_SIZE = 512; // 0.5 KB
const NO_STORE = { "Cache-Control": "no-store" };

// Rate limit: max 10 GROUP joins per board per hour (separate from vote writes)
const RATE_LIMIT_MAX_JOINS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function json(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function action({ request, params }) {
  // Only POST allowed
  if (request.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  // Authenticate via App Proxy
  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop;

  if (!shop) {
    return json({ error: { code: VOTE_ERRORS.NOT_FOUND } }, 404);
  }

  // Check content length
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    return json({ error: { code: VOTE_ERRORS.INVALID } }, 400);
  }

  // Parse body
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_SIZE) {
      return json({ error: { code: VOTE_ERRORS.INVALID } }, 400);
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: { code: VOTE_ERRORS.INVALID } }, 400);
  }

  // Validate firstName
  const { firstName: rawFirstName } = body || {};
  const { value: firstName, error: nameError } = validateVoterName(rawFirstName);
  if (nameError) {
    return json({ error: { code: VOTE_ERRORS.INVALID, message: nameError } }, 400);
  }

  // Token is the board groupToken
  const groupToken = params.token;
  if (!groupToken) {
    return json({ error: { code: VOTE_ERRORS.NOT_FOUND } }, 404);
  }

  // Get settings to check if feature is enabled
  const settings = await getSettings(shop);
  if (!settings.enabled) {
    return json({ error: { code: VOTE_ERRORS.DISABLED } }, 404);
  }

  // Find board by group token
  const board = await getBoardByGroupToken(groupToken);
  if (!board || board.shop !== shop) {
    log.info("join.not_found", { shop });
    return json({ error: { code: VOTE_ERRORS.NOT_FOUND } }, 404);
  }

  // Check expiry
  if (board.expiresAt < new Date()) {
    log.info("join.expired", { shop, boardId: board.id });
    return json({ error: { code: VOTE_ERRORS.EXPIRED } }, 410);
  }

  // Check board status
  if (board.status !== "SHARED" && board.status !== "VOTED") {
    return json({ error: { code: VOTE_ERRORS.NOT_FOUND } }, 404);
  }

  // Check if board is full
  if (board._count.voters >= board.maxVoters) {
    log.info("join.board_full", { shop, boardId: board.id, voters: board._count.voters });
    return json({ error: { code: "board_full", message: "This board already has 5 voters." } }, 400);
  }

  // Rate limit: count GROUP voters created for this board in the last hour
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentGroupJoins = await db.voter.count({
    where: {
      boardId: board.id,
      kind: "GROUP",
      createdAt: { gte: windowStart },
    },
  });

  if (recentGroupJoins >= RATE_LIMIT_MAX_JOINS) {
    log.warn("join.rate_limited", { shop, boardId: board.id, joins: recentGroupJoins });
    return json({ error: { code: VOTE_ERRORS.RATE_LIMITED, message: "Too many tries. Try again in a few minutes." } }, 429);
  }

  // Create GROUP voter
  const { voter, error } = await joinGroupBoard(board.id, firstName, board.maxVoters);
  if (error) {
    log.info("join.board_full", { shop, boardId: board.id });
    return json({ error: { code: "board_full", message: "This board already has 5 voters." } }, 400);
  }

  log.info("join.created", { shop, boardId: board.id, voterId: voter.id });

  return json({ voterToken: voter.token }, 201);
}

// No loader - POST only
export function loader() {
  return json({ error: { code: "method_not_allowed" } }, 405);
}
