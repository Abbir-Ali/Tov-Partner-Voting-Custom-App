/**
 * Vote model: submit and manage votes on board items.
 * Updated for group voting: votes are now per voter, not per board.
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
import { setVoterCompleted, buildGroupSummary } from "./voter.server.js";
import { recordEvent } from "./events.server.js";

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
 * Submit a vote for a board item by a voter. Handles:
 * - Voter and board lookup
 * - Rate limiting (voteWrites counter)
 * - Upsert vote with voterId
 * - Mark voter completed when all items voted
 * - Board status transition when first voter completes
 *
 * @param {{ shop: string, voterToken: string, itemId: string, verdict: string, reason?: string, reasonText?: string, settings: object }}
 * @returns {{ ok: true, data: object } | { ok: false, error: { code: string, status: number } }}
 */
export async function submitVote({ shop, voterToken, itemId, verdict, reason, reasonText, settings }) {
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

  // Fetch voter with board and items
  const voter = await db.voter.findUnique({
    where: { token: voterToken },
    include: {
      board: {
        include: {
          items: {
            orderBy: { position: "asc" },
          },
          _count: { select: { voters: true } },
        },
      },
      votes: { select: { boardItemId: true } },
    },
  });

  if (!voter || voter.board.shop !== shop) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.NOT_FOUND, status: 404 },
    };
  }

  const board = voter.board;

  // Check expiry
  if (board.expiresAt < new Date()) {
    return {
      ok: false,
      error: { code: VOTE_ERRORS.EXPIRED, status: 410 },
    };
  }

  // Completed voters can still update votes until the board expires.
  // Completion side effects (notification, event) fire once on first completion.

  // Check if board is shared (can still vote even if another voter completed)
  if (board.status !== "SHARED" && board.status !== "VOTED") {
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

  // Check current state
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
    const shouldReset = !board.voteWindowStart || board.voteWindowStart <= windowStart;

    await tx.board.update({
      where: { id: board.id },
      data: shouldReset
        ? { voteWrites: 1, voteWindowStart: now }
        : { voteWrites: { increment: 1 } },
    });

    // Upsert vote for this voter + item
    const existingVote = await tx.vote.findUnique({
      where: { boardItemId_voterId: { boardItemId: itemId, voterId: voter.id } },
    });
    const verdictChanged = existingVote && existingVote.verdict !== verdict;

    // Sanitize reasonText (only for "other" reason)
    const effectiveReason = verdictChanged ? null : (reason !== undefined ? (reason || null) : existingVote?.reason);
    const sanitizedText = effectiveReason === "other" && reasonText !== undefined
      ? sanitizeReasonText(reasonText)
      : (verdictChanged ? null : (reasonText !== undefined ? sanitizeReasonText(reasonText) : existingVote?.reasonText));

    const vote = await tx.vote.upsert({
      where: { boardItemId_voterId: { boardItemId: itemId, voterId: voter.id } },
      create: {
        boardItemId: itemId,
        voterId: voter.id,
        verdict,
        reason: reason || null,
        reasonText: reason === "other" ? sanitizeReasonText(reasonText) : null,
        voterName: voter.firstName,
      },
      update: {
        verdict,
        reason: effectiveReason,
        reasonText: effectiveReason === "other" ? sanitizedText : null,
      },
    });

    // Count this voter's votes
    const voterVotedCount = await tx.vote.count({
      where: { voterId: voter.id },
    });

    let voterCompleted = false;
    if (voterVotedCount === totalItems && !voter.completedAt) {
      voterCompleted = true;
    }

    // Get this voter's vote counts
    const voterVotes = await tx.vote.findMany({
      where: { voterId: voter.id },
    });

    const counts = { love: 0, maybe: 0, pass: 0 };
    for (const v of voterVotes) {
      counts[v.verdict.toLowerCase()]++;
    }

    return {
      vote,
      voterCompleted,
      boardId: board.id,
      voterId: voter.id,
      voterFirstName: voter.firstName,
      voted: voterVotes.length,
      total: totalItems,
      counts,
      votersTotal: board._count.voters,
    };
  });

  // Mark voter completed and update board status (outside transaction for notification)
  if (result.voterCompleted) {
    await setVoterCompleted(result.voterId, result.boardId);

    // Get completed voter count for analytics
    const completedCount = await db.voter.count({
      where: { boardId: result.boardId, completedAt: { not: null } },
    });

    // Record analytics event
    await recordEvent(shop, "vote_completed", {
      boardId: result.boardId,
      meta: {
        votersDone: completedCount,
        votersInvited: result.votersTotal,
      },
    });

    // Fire notification for this voter
    triggerVoterNotification(result.voterId, result.boardId, shop);
  }

  // Build groupSummary when voter completes
  let groupSummary = null;
  if (result.voterCompleted) {
    // Get board items with titles for summary
    const boardWithItems = await db.board.findUnique({
      where: { id: result.boardId },
      select: {
        ownerFirstName: true,
        items: {
          orderBy: { position: "asc" },
          select: { id: true },
        },
      },
    });
    if (boardWithItems) {
      // Build minimal items array (summary only needs id, title comes from existing item cache on client)
      const items = boardWithItems.items.map((item) => ({ id: item.id, title: "" }));
      groupSummary = await buildGroupSummary(
        result.boardId,
        result.voterId,
        items,
        boardWithItems.ownerFirstName
      );
    }
  }

  return {
    ok: true,
    data: {
      boardId: result.boardId,
      voted: result.voted,
      total: result.total,
      complete: result.voterCompleted,
      counts: result.counts,
      groupSummary,
    },
  };
}

// Fire-and-forget notification after voter completes.
function triggerVoterNotification(voterId, boardId, shop) {
  sendVotingCompleted(voterId, boardId, shop).catch(() => {
    // Errors are logged inside sendVotingCompleted; nothing to do here.
  });
}

/**
 * Get all votes for a board (for the loader).
 */
export async function getVotesForBoard(boardId) {
  return db.vote.findMany({
    where: { boardItem: { boardId } },
    include: { boardItem: true, voter: { select: { id: true, firstName: true } } },
  });
}

/**
 * Get votes for a specific voter.
 */
export async function getVotesForVoter(voterId) {
  return db.vote.findMany({
    where: { voterId },
    include: { boardItem: true },
  });
}
