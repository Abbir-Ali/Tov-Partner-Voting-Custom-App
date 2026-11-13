import db from "../db.server.js";
import { DEFAULT_COPY, LIMITS } from "./settings.shared.js";
import { encrypt } from "../utils/crypto.server.js";

// Re-export so server-only callers that already import from here keep working.
export { DEFAULT_COPY, LIMITS };

/**
 * Returns settings for a shop merged with defaults.
 * copy keys with empty-string values fall back to DEFAULT_COPY.
 * Does NOT write to the DB if no row exists.
 */
export async function getSettings(shop) {
  const row = await db.shopSettings.findUnique({ where: { shop } });

  if (!row) {
    return {
      enabled:              false,
      abTestEnabled:        false,
      abTestPercent:        50,
      boardExpiryDays:      30,
      maxItemsPerBoard:     12,
      maxSharesPerDay:      10,
      notificationsEnabled: true,
      excludeTag:           "pvb-exclude",
      copy:                 { ...DEFAULT_COPY },
      klaviyoKeyEncrypted:  null,
      klaviyoKeyLast4:      null,
      klaviyoConnectedAt:   null,
      updatedAt:            null,
    };
  }

  const savedCopy =
    row.copy !== null && typeof row.copy === "object" ? row.copy : {};

  const mergedCopy = {
    ...DEFAULT_COPY,
    ...Object.fromEntries(
      Object.entries(savedCopy).filter(
        ([k, v]) => k in DEFAULT_COPY && typeof v === "string" && v.trim() !== ""
      )
    ),
  };

  return { ...row, copy: mergedCopy };
}

/**
 * Pure validation function.
 * @param {Record<string, unknown>} input – flat object from formData
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateSettings(input) {
  const errors = {};
  const data   = {};

  // Booleans — switches send "on" when checked, absent (null) when not.
  const parseBool = (v) => v === "on" || v === "true" || v === true;
  data.enabled              = parseBool(input.enabled);
  data.abTestEnabled        = parseBool(input.abTestEnabled);
  data.notificationsEnabled = parseBool(input.notificationsEnabled);

  // Integers within ranges.
  const validateInt = (key, raw, [min, max]) => {
    const trimmed = String(raw ?? "").trim();
    const n = parseInt(trimmed, 10);
    if (!Number.isInteger(n) || String(n) !== trimmed || n < min || n > max) {
      errors[key] = `Must be a whole number between ${min} and ${max}.`;
      return null;
    }
    return n;
  };
  data.abTestPercent    = validateInt("abTestPercent",    input.abTestPercent,    LIMITS.abTestPercent);
  data.boardExpiryDays  = validateInt("boardExpiryDays",  input.boardExpiryDays,  LIMITS.boardExpiryDays);
  data.maxItemsPerBoard = validateInt("maxItemsPerBoard", input.maxItemsPerBoard, LIMITS.maxItemsPerBoard);
  data.maxSharesPerDay  = validateInt("maxSharesPerDay",  input.maxSharesPerDay,  LIMITS.maxSharesPerDay);

  // excludeTag — letters, numbers, hyphens, underscores only.
  const tag = String(input.excludeTag ?? "").trim();
  if (tag.length > LIMITS.excludeTagMaxLength) {
    errors.excludeTag = `Must be ${LIMITS.excludeTagMaxLength} characters or fewer.`;
  } else if (tag !== "" && !/^[a-zA-Z0-9_-]+$/.test(tag)) {
    errors.excludeTag = "Only letters, numbers, hyphens, and underscores are allowed.";
  } else {
    data.excludeTag = tag;
  }

  // copy — only known keys; trimmed; within max length.
  const copy = {};
  for (const key of Object.keys(DEFAULT_COPY)) {
    const val = String(input[`copy.${key}`] ?? "").trim();
    if (val.length > LIMITS.copyMaxLength) {
      errors[`copy.${key}`] = `Must be ${LIMITS.copyMaxLength} characters or fewer.`;
    } else {
      copy[key] = val; // empty string means "use default" (filtered in getSettings)
    }
  }
  // Reject unknown copy keys.
  for (const key of Object.keys(input)) {
    if (key.startsWith("copy.") && !(key.slice(5) in DEFAULT_COPY)) {
      errors[key] = "Unknown copy key.";
    }
  }
  data.copy = copy;

  return { data, errors };
}

/** Upsert settings row for a shop. */
export async function saveSettings(shop, data) {
  return db.shopSettings.upsert({
    where:  { shop },
    update: data,
    create: { shop, ...data },
  });
}


/**
 * Saves the Klaviyo private API key (encrypted).
 * @param {string} shop
 * @param {string} plainKey - The raw API key
 */
export async function saveKlaviyoKey(shop, plainKey) {
  const encrypted = encrypt(plainKey);
  if (!encrypted) {
    throw new Error("Encryption failed - check APP_ENCRYPTION_KEY");
  }

  const last4 = plainKey.slice(-4);

  return db.shopSettings.upsert({
    where: { shop },
    update: {
      klaviyoKeyEncrypted: encrypted,
      klaviyoKeyLast4: last4,
      klaviyoConnectedAt: new Date(),
    },
    create: {
      shop,
      klaviyoKeyEncrypted: encrypted,
      klaviyoKeyLast4: last4,
      klaviyoConnectedAt: new Date(),
    },
  });
}

/**
 * Removes the Klaviyo key from settings.
 */
export async function removeKlaviyoKey(shop) {
  return db.shopSettings.update({
    where: { shop },
    data: {
      klaviyoKeyEncrypted: null,
      klaviyoKeyLast4: null,
      klaviyoConnectedAt: null,
    },
  });
}
