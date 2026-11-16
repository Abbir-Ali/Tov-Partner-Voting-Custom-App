/**
 * Shared constants for the Boards list page.
 * Used by both server (audit.server.js) and client (app.boards.jsx).
 */

// Saved view definitions
export const SAVED_VIEWS = {
  all: { label: "All" },
  waiting: { label: "Waiting for votes" },
  voted_no_order: { label: "Voted, no order" },
  ordered: { label: "Ordered" },
  repeat: { label: "Repeat buyers" },
  expiring: { label: "Expiring soon" },
};

// Sort options
export const SORT_OPTIONS = {
  newest: { field: "sharedAt", dir: "desc", label: "Newest" },
  oldest: { field: "sharedAt", dir: "asc", label: "Oldest" },
  pieces_desc: { field: "pieceCount", dir: "desc", label: "Most pieces" },
  loved_desc: { field: "loveCount", dir: "desc", label: "Most loved" },
  value_desc: { field: "orderValue", dir: "desc", label: "Order value high-low" },
  expiring: { field: "expiresAt", dir: "asc", label: "Expiring soonest" },
};
