/**
 * Vote constants shared between server and client.
 */

export const VERDICTS = ['LOVE', 'MAYBE', 'PASS'];

export const VOTE_ERRORS = {
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  LOCKED: 'locked',
  DISABLED: 'disabled',
  INVALID: 'invalid',
  RATE_LIMITED: 'rate_limited',
};

// Abuse guard: max vote writes per board = itemCount * RATE_LIMIT_MULTIPLIER
export const RATE_LIMIT_MULTIPLIER = 20;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
