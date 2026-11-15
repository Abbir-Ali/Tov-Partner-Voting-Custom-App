/**
 * POST /apps/board/api/boards/:token/votes
 *
 * Vote API endpoint served via App Proxy.
 * Body: { itemId: string, verdict: "LOVE"|"MAYBE"|"PASS" }
 * Max body size: 1 KB
 */

import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";
import { submitVote, VOTE_ERRORS } from "../models/vote.server.js";
import { recordEvent } from "../models/events.server.js";
import { log } from "../utils/log.server.js";

const MAX_BODY_SIZE = 1024; // 1 KB
const NO_STORE = { "Cache-Control": "no-store" };

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

  // Validate required fields
  const { itemId, verdict } = body || {};
  if (typeof itemId !== "string" || !itemId.trim()) {
    return json({ error: { code: VOTE_ERRORS.INVALID } }, 400);
  }

  if (typeof verdict !== "string") {
    return json({ error: { code: VOTE_ERRORS.INVALID } }, 400);
  }

  const token = params.token;
  if (!token) {
    return json({ error: { code: VOTE_ERRORS.NOT_FOUND } }, 404);
  }

  // Get settings
  const settings = await getSettings(shop);

  // Submit vote
  const result = await submitVote({
    shop,
    token,
    itemId: itemId.trim(),
    verdict: verdict.toUpperCase(),
    settings,
  });

  if (!result.ok) {
    log.error("vote.rejected", { shop, code: result.error.code });
    return json({ error: { code: result.error.code } }, result.error.status);
  }

  log.info("vote.saved", {
    shop,
    verdict: verdict.toUpperCase(),
    voted: result.data.voted,
    total: result.data.total,
  });

  if (result.data.complete) {
    log.info("vote.completed", { shop, total: result.data.total });
    await recordEvent(shop, "vote_completed", { boardId: result.data.boardId });
  }

  return json(result.data, 200);
}

// No loader - POST only
export function loader() {
  return json({ error: { code: "method_not_allowed" } }, 405);
}
