/**
 * Vote model: submit and manage votes on board items.
 */

import db from "../db.server.js";
import { sendVotingCompleted } from "../services/notify.server.js";
import {
  VERDICTS,
  VOTE_ERRORS,
  RATE_LIMIT_MULTIPLIER,
  RATE_LIMIT_WINDOW_MS,
} from "./vote.shared.js";
import { isValidReason } from "./reasons.shared.js";

export { VERDICTS, VOTE_ERRORS };

// PII patterns: email and phone (US/intl formats)
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,9}/g;

/**
 * Sanitize reasonText: trim, collapse whitespace, strip PII.
 * @param {string} text
 * @returns {string|null}
 */
function sanitizeReasonText(text) {
  if (!text || typeof text !== "string") return null;
  let clean = text.trim().replace(/\s+/g, " ");
  if (clean.length > 120) clean = clean.slice(0, 120);
  // Replace PII with ellipsis
  clean = clean.replace(EMAIL_PATTERN, "…");
  clean = clean.replace(PHONE_PATTERN, "…");
  return clean || null;
}

/**
 * Submit a vote for a board item. Handles:
 * - Board lookup and status validation
 * - Rate limiting (voteWrites counter)
 * - Upsert vote (voterName from board.partnerFirstName)
 * - Atomic SHARED -> VOTED transition when all items voted
 *
 * @param {{ shop: string, token: string, itemId: string, verdict: string, reason?: string, reasonText?: string, settings: object }}
 * @returns {{ ok: true, data: object } | { ok: false, error: { code: string, status: number } }}
 */
export async function submitVote({ shop, token, itemId, verdict, reason, reasonText, settings }) {
  // Validate verdict
  if (!VERDICTS.includes(verdict)) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.INVALID, status: 400 },
    };
  }

  // Validate reason if provided (using shop's chips)
  if (reason && !isValidReason(verdict, reason, settings.reasonChips, false)) {
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
    // On verdict change: clear reason/reasonText. On same verdict: keep existing if field is undefined.
    const existingVote = await tx.vote.findUnique({ where: { boardItemId: itemId } });
    const verdictChanged = existingVote && existingVote.verdict !== verdict;

    // Sanitize reasonText (only for "other" reason)
    const effectiveReason = verdictChanged ? null : (reason !== undefined ? (reason || null) : existingVote?.reason);
    const sanitizedText = effectiveReason === "other" && reasonText !== undefined
      ? sanitizeReasonText(reasonText)
      : (verdictChanged ? null : (reasonText !== undefined ? sanitizeReasonText(reasonText) : existingVote?.reasonText));

    const vote = await tx.vote.upsert({
      where: { boardItemId: itemId },
      create: {
        boardItemId: itemId,
        verdict,
        reason: reason || null,
        reasonText: reason === "other" ? sanitizeReasonText(reasonText) : null,
        voterName: board.partnerFirstName || "Partner",
      },
      update: {
        verdict,
        reason: effectiveReason,
        reasonText: effectiveReason === "other" ? sanitizedText : null,
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
      boardId: board.id,
      voted: votes.length,
      total: totalItems,
      counts,
    };
  });

  // Fire notification after board completes (non-blocking, doesn't delay response)
  if (result.boardCompleted) {
    triggerNotification(result.boardId);
  }

  return {
    ok: true,
    data: {
      boardId: result.boardId,
      voted: result.voted,
      total: result.total,
      complete: result.boardCompleted,
      counts: result.counts,
    },
  };
}

// Fire-and-forget notification after board completes (outside the main return).
// This runs after the vote response is sent.
function triggerNotification(boardId) {
  sendVotingCompleted(boardId).catch(() => {
    // Errors are logged inside sendVotingCompleted; nothing to do here.
  });
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
