/**
 * Vote model: submit and manage votes on board items.
 */

import db from "../db.server.js";
import {
  VERDICTS,
  VOTE_ERRORS,
  RATE_LIMIT_MULTIPLIER,
  RATE_LIMIT_WINDOW_MS,
} from "./vote.shared.js";

export { VERDICTS, VOTE_ERRORS };

/**
 * Submit a vote for a board item. Handles:
 * - Board lookup and status validation
 * - Rate limiting (voteWrites counter)
 * - Upsert vote (voterName from board.partnerFirstName)
 * - Atomic SHARED -> VOTED transition when all items voted
 *
 * @param {{ shop: string, token: string, itemId: string, verdict: string, settings: object }}
 * @returns {{ ok: true, data: object } | { ok: false, error: { code: string, status: number } }}
 */
export async function submitVote({ shop, token, itemId, verdict, settings }) {
  // Validate verdict
  if (!VERDICTS.includes(verdict)) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.INVALID, status: 400 },
    };
  }

  // Check if feature is enabled
  if (!settings.enabled) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.DISABLED, status: 404 },
    };
  }

  // Fetch board with items (scoped by shop)
  const board = await db.board.findFirst({
    where: { shop, shareToken: token },
    include: {
      items: {
        include: { votes: true },
        orderBy: { position: "asc" },
      },
    },
  });

  if (!board) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.NOT_FOUND, status: 404 },
    };
  }

  // Check expiry
  if (board.expiresAt < new Date()) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.EXPIRED, status: 410 },
    };
  }

  // Check if already completed (VOTED)
  if (board.status === "VOTED") {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.LOCKED, status: 409 },
    };
  }

  // Check if board is in SHARED status
  if (board.status !== "SHARED") {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.NOT_FOUND, status: 404 },
    };
  }

  // Verify itemId belongs to this board
  const item = board.items.find((i) => i.id === itemId);
  if (!item) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.INVALID, status: 400 },
    };
  }

  // Rate limit check and increment in one statement
  const totalItems = board.items.length;
  const maxWrites = totalItems * RATE_LIMIT_MULTIPLIER;
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  // Atomic rate limit update: reset if window expired, else increment
  // First, check current state
  if (
    board.voteWindowStart &&
    board.voteWindowStart > windowStart &&
    board.voteWrites >= maxWrites
  ) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.RATE_LIMITED, status: 429 },
    };
  }

  // Perform vote and rate limit update in transaction
  const result = await db.$transaction(async (tx) => {
    // Update rate limit counter atomically
    // If window is null or older than 1 hour, reset to (1, now)
    // Otherwise increment
    const shouldReset = !board.voteWindowStart || board.voteWindowStart <= windowStart;

    await tx.board.update({
      where: { id: board.id },
      data: shouldReset
        ? { voteWrites: 1, voteWindowStart: now }
        : { voteWrites: { increment: 1 } },
    });

    // Upsert vote (voterName is always partnerFirstName)
    const vote = await tx.vote.upsert({
      where: { boardItemId: itemId },
      create: {
        boardItemId: itemId,
        verdict,
        voterName: board.partnerFirstName || "Partner",
      },
      update: {
        verdict,
        // voterName stays the same
      },
    });

    // Check if all items now have votes
    const votedCount = await tx.vote.count({
      where: { boardItem: { boardId: board.id } },
    });

    let boardCompleted = false;
    if (votedCount === totalItems) {
      // Atomic transition: only if still SHARED
      const updated = await tx.board.updateMany({
        where: { id: board.id, status: "SHARED" },
        data: { status: "VOTED", votingCompletedAt: now },
      });
      boardCompleted = updated.count > 0;
    }

    // Get updated vote counts
    const votes = await tx.vote.findMany({
      where: { boardItem: { boardId: board.id } },
    });

    const counts = { love: 0, maybe: 0, pass: 0 };
    for (const v of votes) {
      counts[v.verdict.toLowerCase()]++;
    }

    return {
      vote,
      boardCompleted,
      voted: votes.length,
      total: totalItems,
      counts,
    };
  });

  return {
    ok: true,
    data: {
      voted: result.voted,
      total: result.total,
      complete: result.boardCompleted,
      counts: result.counts,
    },
  };
}

/**
 * Get all votes for a board (for the loader).
 */
export async function getVotesForBoard(boardId) {
  return db.vote.findMany({
    where: { boardItem: { boardId } },
    include: { boardItem: true },
  });
}
