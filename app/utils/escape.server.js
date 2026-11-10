/**
 * Escape a string for safe insertion into Liquid templates rendered by
 * Shopify's App Proxy. Prevents both HTML injection (XSS) and Liquid
 * template injection (e.g. {{ shop.email }}, {% assign %}).
 *
 * @param {unknown} str
 * @returns {string}
 */
export function escapeForLiquid(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}
