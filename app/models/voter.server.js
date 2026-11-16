/**
 * Voter model: personal and group voting links.
 */
import db from "../db.server.js";
import { newToken } from "../utils/tokens.server.js";

const NAME_RE = /^[\p{L} '-]+$/u;
const MAX_NAME_LENGTH = 30;

/**
 * Validate a voter first name.
 * @param {string} name
 * @returns {{ value: string, error: string|null }}
 */
export function validateVoterName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return { value: "", error: "First name is required." };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { value: "", error: `Keep your name under ${MAX_NAME_LENGTH} characters.` };
  }
  if (!NAME_RE.test(trimmed)) {
    return { value: "", error: "Only letters, spaces, hyphens, and apostrophes." };
  }
  // Capitalize if all lowercase
  const value = trimmed === trimmed.toLowerCase()
    ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    : trimmed;
  return { value, error: null };
}

/**
 * Create a PERSONAL voter for a board (used when sharing).
 * @param {string} boardId
 * @param {string} firstName
 * @returns {Promise<{ id: string, token: string }>}
 */
export async function createPersonalVoter(boardId, firstName) {
  const voter = await db.voter.create({
    data: {
      boardId,
      token: newToken(),
      firstName,
      kind: "PERSONAL",
    },
    select: { id: true, token: true },
  });
  return voter;
}

/**
 * Join a group board (create GROUP voter).
 * @param {string} boardId
 * @param {string} firstName
 * @param {number} maxVoters
 * @returns {Promise<{ voter?: { id: string, token: string }, error?: string }>}
 */
export async function joinGroupBoard(boardId, firstName, maxVoters = 5) {
  // Count existing voters
  const count = await db.voter.count({ where: { boardId } });
  if (count >= maxVoters) {
    return { error: "This board already has the maximum number of voters." };
  }

  const voter = await db.voter.create({
    data: {
      boardId,
      token: newToken(),
      firstName,
      kind: "GROUP",
    },
    select: { id: true, token: true },
  });
  return { voter };
}

/**
 * Get voter by token.
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function getVoterByToken(token) {
  if (typeof token !== "string" || !token) return null;
  return db.voter.findUnique({
    where: { token },
    include: {
      board: {
        select: {
          id: true,
          shop: true,
          ownerFirstName: true,
          status: true,
          hidePrices: true,
          expiresAt: true,
          items: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              productId: true,
              variantId: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Get board by group token (for group join).
 * @param {string} groupToken
 * @returns {Promise<object|null>}
 */
export async function getBoardByGroupToken(groupToken) {
  if (typeof groupToken !== "string" || !groupToken) return null;
  return db.board.findUnique({
    where: { groupToken },
    select: {
      id: true,
      shop: true,
      shareToken: true,
      ownerFirstName: true,
      status: true,
      hidePrices: true,
      maxVoters: true,
      expiresAt: true,
      _count: { select: { voters: true } },
    },
  });
}

/**
 * Mark voter as opened (first visit to vote page).
 * @param {string} voterId
 */
export async function setVoterOpenedAt(voterId) {
  await db.voter.update({
    where: { id: voterId },
    data: { openedAt: new Date() },
  });
}

/**
 * Mark voter as completed (all items voted).
 * Also updates board status and votingCompletedAt if this is the first completion.
 * @param {string} voterId
 * @param {string} boardId
 */
export async function setVoterCompleted(voterId, boardId) {
  const now = new Date();

  await db.$transaction([
    db.voter.update({
      where: { id: voterId },
      data: { completedAt: now },
    }),
    // Update board status to VOTED if this is the first voter to complete
    db.board.updateMany({
      where: {
        id: boardId,
        status: "SHARED",
        votingCompletedAt: null,
      },
      data: {
        status: "VOTED",
        votingCompletedAt: now,
      },
    }),
  ]);
}

/**
 * Get votes for a board by all voters who have completed.
 * Used for thank-you screen group summary.
 * @param {string} boardId
 * @returns {Promise<Map<string, Array<{ voterFirstName, voterId, verdict, reason, reasonText }>>>}
 */
export async function getCompletedVotes(boardId) {
  const votes = await db.vote.findMany({
    where: {
      boardItem: { boardId },
      voter: { completedAt: { not: null } },
    },
    select: {
      boardItemId: true,
      verdict: true,
      reason: true,
      reasonText: true,
      voter: {
        select: { id: true, firstName: true },
      },
    },
  });

  // Group by boardItemId
  const byItem = new Map();
  for (const v of votes) {
    const list = byItem.get(v.boardItemId) || [];
    list.push({
      voterId: v.voter.id,
      voterFirstName: v.voter.firstName,
      verdict: v.verdict,
      reason: v.reason,
      reasonText: v.reasonText,
    });
    byItem.set(v.boardItemId, list);
  }
  return byItem;
}

/**
 * Get voter stats for a board (for thank-you screen).
 * @param {string} boardId
 * @returns {Promise<{ total: number, completed: number }>}
 */
export async function getVoterStats(boardId) {
  const [total, completed] = await Promise.all([
    db.voter.count({ where: { boardId } }),
    db.voter.count({ where: { boardId, completedAt: { not: null } } }),
  ]);
  return { total, completed };
}

/**
 * Build group summary for thank-you screen.
 * @param {string} boardId
 * @param {string} currentVoterId - The voter viewing the summary
 * @param {Array<{id: string, title: string}>} items - Board items with titles
 * @param {string} shopperFirstName - The board owner's first name
 * @returns {Promise<{votersDone: number, votersInvited: number, shopperFirstName: string, items: Array}>}
 */
export async function buildGroupSummary(boardId, currentVoterId, items, shopperFirstName = "The shopper") {
  const [stats, completedVotesMap] = await Promise.all([
    getVoterStats(boardId),
    getCompletedVotes(boardId),
  ]);

  // Build per-item summary
  const summaryItems = [];
  for (const item of items) {
    const votes = completedVotesMap.get(item.id) || [];
    if (votes.length === 0) continue;

    const loves = votes.filter((v) => v.verdict === "LOVE");
    const maybes = votes.filter((v) => v.verdict === "MAYBE");
    const passes = votes.filter((v) => v.verdict === "PASS");

    // Find my vote and others
    const myVote = votes.find((v) => v.voterId === currentVoterId);
    const others = votes.filter((v) => v.voterId !== currentVoterId);

    let line = "";
    let tag = "";

    if (loves.length === votes.length) {
      // All loved
      if (votes.length === 1) {
        line = "You loved it";
      } else {
        line = joinNames("You", others.map((v) => v.voterFirstName)) + " loved it";
      }
      tag = `${votes.length} Loved`;
    } else if (passes.length === votes.length) {
      // All not for us
      line = "Not for anyone";
      tag = "Not For Us";
    } else if (maybes.length === votes.length) {
      // All maybe
      if (votes.length === 1) {
        line = "You said Maybe";
      } else if (votes.length === 2) {
        line = "Both said Maybe";
      } else {
        line = `All ${votes.length} said Maybe`;
      }
      tag = `${votes.length} Maybe`;
    } else {
      // Mixed: "You loved it · Alex: Maybe · Zaid: Not For Us"
      const parts = [];
      if (myVote) {
        if (myVote.verdict === "LOVE") {
          parts.push("You loved it");
        } else if (myVote.verdict === "MAYBE") {
          parts.push("You said Maybe");
        } else {
          parts.push("You said Not For Us");
        }
      }
      for (const o of others) {
        if (o.verdict === "LOVE") {
          parts.push(`${o.voterFirstName} loved it`);
        } else if (o.verdict === "MAYBE") {
          parts.push(`${o.voterFirstName}: Maybe`);
        } else {
          parts.push(`${o.voterFirstName}: Not For Us`);
        }
      }
      line = parts.join(" · ");
      tag = "Split";
    }

    summaryItems.push({
      itemId: item.id,
      name: item.title,
      line,
      tag,
    });
  }

  return {
    votersDone: stats.completed,
    votersInvited: stats.total,
    shopperFirstName: shopperFirstName || "The shopper",
    items: summaryItems,
  };
}

/**
 * Join names: "You, Alex and Zaid" or "You and Alex"
 */
function joinNames(first, rest) {
  if (rest.length === 0) return first;
  if (rest.length === 1) return `${first} and ${rest[0]}`;
  return `${first}, ${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`;
}
