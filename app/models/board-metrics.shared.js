/**
 * Board metrics definitions for admin pages.
 * Used in: Boards list, Board detail, Home, Analytics.
 *
 * Key concepts:
 * - Voters invited = number of Voter rows on the board
 * - Voters done = voters with completedAt set
 * - Vote rate = voters done / voters invited
 */

/**
 * Board status for admin display.
 * @param {object} board - Board with voters array
 * @param {boolean} hasOrder - Whether board has an order
 * @returns {{ status: string, tone: string }}
 */
export function getBoardStatus(board, hasOrder = false) {
  const voters = board.voters || [];
  const personalVoters = voters.filter((v) => v.kind === "PERSONAL");
  const doneVoters = voters.filter((v) => v.completedAt);
  const donePersonal = personalVoters.filter((v) => v.completedAt);

  // Expired check
  if (board.expiresAt && new Date(board.expiresAt) < new Date()) {
    return { status: "Expired", tone: "neutral" };
  }

  // Ordered (voted + order)
  if (hasOrder) {
    return { status: "Ordered", tone: "info" };
  }

  // Voted = all PERSONAL voters done (group joins that started but didn't finish don't block)
  if (personalVoters.length > 0 && donePersonal.length === personalVoters.length) {
    return { status: "Voted", tone: "success" };
  }

  // Partly voted = some done, not all personal done
  if (doneVoters.length > 0) {
    return { status: "Partly voted", tone: "attention" };
  }

  // Waiting for votes = 0 done
  return { status: "Waiting for votes", tone: "attention" };
}

/**
 * Count voters by status.
 * @param {Array} voters - Array of voter objects
 * @returns {{ invited: number, done: number, opened: number }}
 */
export function getVoterCounts(voters = []) {
  return {
    invited: voters.length,
    done: voters.filter((v) => v.completedAt).length,
    opened: voters.filter((v) => v.openedAt).length,
  };
}

/**
 * Aggregate vote counts across all voters.
 * @param {Array} items - Board items with votes array
 * @returns {{ love: number, maybe: number, pass: number }}
 */
export function getVoteCounts(items = []) {
  let love = 0, maybe = 0, pass = 0;
  for (const item of items) {
    for (const vote of item.votes || []) {
      if (vote.verdict === "LOVE") love++;
      else if (vote.verdict === "MAYBE") maybe++;
      else if (vote.verdict === "PASS") pass++;
    }
  }
  return { love, maybe, pass };
}

/**
 * Format voters for display (up to 5 faces).
 * @param {Array} voters - Array of voter objects
 * @returns {Array<{ firstName: string, avatarKey: string, done: boolean }>}
 */
export function formatVotersForDisplay(voters = []) {
  return voters.slice(0, 5).map((v) => ({
    firstName: v.firstName,
    avatarKey: v.avatarKey,
    done: !!v.completedAt,
    opened: !!v.openedAt,
  }));
}

/**
 * Build voter summary text.
 * @param {Array} voters - Array of voter objects
 * @returns {string} e.g. "2 of 3 voted"
 */
export function getVoterSummaryText(voters = []) {
  const counts = getVoterCounts(voters);
  if (counts.invited === 0) return "No voters";
  // Always show "X of Y voted" format for consistency
  return `${counts.done} of ${counts.invited} voted`;
}
