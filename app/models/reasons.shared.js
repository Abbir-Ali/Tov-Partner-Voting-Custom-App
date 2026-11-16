/**
 * Vote reason chips: defaults, validation and label lookup.
 * Shared by server, dashboard, Sidekick and vote page.
 */

// Default chips (code + label). "other" is implicit (always last, can't be removed).
export const DEFAULT_PASS_CHIPS = [
  { code: "color", label: "Color", active: true },
  { code: "size", label: "Size", active: true },
  { code: "price", label: "Price", active: true },
  { code: "style", label: "Style", active: true },
  { code: "material", label: "Material", active: true },
  { code: "comfort", label: "Comfort", active: true },
];

export const DEFAULT_MAYBE_CHIPS = [
  { code: "another_color", label: "Another Color", active: true },
  { code: "different_size", label: "Different Size", active: true },
  { code: "lower_price", label: "Lower Price", active: true },
  { code: "in_person", label: "See It in Person", active: true },
];

// Legacy maps for backward compatibility (dashboard/boards pages use these until updated)
export const PASS_REASONS = Object.fromEntries(DEFAULT_PASS_CHIPS.map(c => [c.code, c.label]));
export const MAYBE_REASONS = Object.fromEntries(DEFAULT_MAYBE_CHIPS.map(c => [c.code, c.label]));
PASS_REASONS.other = "Other";
MAYBE_REASONS.other = "Other";

// For legacy validation
export const VALID_PASS_REASONS = [...DEFAULT_PASS_CHIPS.map(c => c.code), "other"];
export const VALID_MAYBE_REASONS = [...DEFAULT_MAYBE_CHIPS.map(c => c.code), "other"];

/**
 * Check if reason is valid for a verdict using shop's chips.
 * For new votes: only active codes + "other" are valid.
 * For existing votes (history): any code ever used is valid.
 * LOVE never has a reason.
 * @param {string} verdict
 * @param {string} reason
 * @param {object} [chips] - Shop's reasonChips { pass: [], maybe: [] }. Falls back to defaults.
 * @param {boolean} [allowRetired=false] - If true, accept retired codes (for displaying old votes).
 */
export function isValidReason(verdict, reason, chips, allowRetired = false) {
  if (!reason) return true;
  if (verdict === "LOVE") return false;
  if (reason === "other") return verdict === "PASS" || verdict === "MAYBE";

  const list = verdict === "PASS"
    ? (chips?.pass || DEFAULT_PASS_CHIPS)
    : verdict === "MAYBE"
    ? (chips?.maybe || DEFAULT_MAYBE_CHIPS)
    : [];

  return list.some(c => c.code === reason && (allowRetired || c.active));
}

/**
 * Get label for a reason code using shop's chips.
 * Returns "(retired)" suffix for inactive chips.
 * Returns code as-is if not found (safety fallback).
 * @param {string} verdict
 * @param {string} reason
 * @param {object} [chips] - Shop's reasonChips { pass: [], maybe: [] }
 * @returns {string|null}
 */
export function getReasonLabel(verdict, reason, chips) {
  if (!reason) return null;
  if (reason === "other") return "Other";

  const list = verdict === "PASS"
    ? (chips?.pass || DEFAULT_PASS_CHIPS)
    : verdict === "MAYBE"
    ? (chips?.maybe || DEFAULT_MAYBE_CHIPS)
    : [];

  const chip = list.find(c => c.code === reason);
  if (!chip) return reason; // fallback to code if not found
  return chip.active ? chip.label : `${chip.label} (retired)`;
}

/**
 * Get active chips for vote page (label + code, no "active" field).
 * "other" is NOT included; the vote page adds it last.
 * @param {object} [chips] - Shop's reasonChips { pass: [], maybe: [] }
 * @param {string} verdict - "PASS" or "MAYBE"
 * @returns {Array<{ code: string, label: string }>}
 */
export function getActiveChips(chips, verdict) {
  const list = verdict === "PASS"
    ? (chips?.pass || DEFAULT_PASS_CHIPS)
    : verdict === "MAYBE"
    ? (chips?.maybe || DEFAULT_MAYBE_CHIPS)
    : [];

  return list
    .filter(c => c.active)
    .map(c => ({ code: c.code, label: c.label }));
}
