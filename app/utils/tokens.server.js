import crypto from "node:crypto";

/**
 * Returns a 192-bit URL-safe random token.
 * @returns {string} 32-char base64url token
 */
export function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Returns a stable sha256 hex key namespaced by kind.
 * @param {string} shop  - myshopify domain
 * @param {"customer"|"email"} kind
 * @param {string} value - customer GID or lowercased email
 */
export function creatorKey(shop, kind, value) {
  return crypto
    .createHash("sha256")
    .update(`${shop}:${kind}:${value}`)
    .digest("hex");
}
