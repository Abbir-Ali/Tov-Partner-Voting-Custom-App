import db from "../db.server.js";
import { DEFAULT_COPY, LIMITS } from "./settings.shared.js";
import { DEFAULT_PASS_CHIPS, DEFAULT_MAYBE_CHIPS } from "./reasons.shared.js";
import { encrypt } from "../utils/crypto.server.js";
import { addBuyerTag } from "../services/customer-tag.server.js";

// Default setup guide state
const DEFAULT_SETUP_GUIDE = {
  dismissed: false,
  steps: {
    themeButton: false,    // auto: button_impression in last 7d
    klaviyoConnected: false, // auto: key saved
    reasonChipsReviewed: false, // manual: opened + saved chips
    copyCustomized: false, // auto: copy differs from defaults
    sidekickEnabled: false, // manual: "mark done"
  },
};

// Re-export so server-only callers that already import from here keep working.
export { DEFAULT_COPY, LIMITS };

/**
 * Returns settings for a shop merged with defaults.
 * copy keys with empty-string values fall back to DEFAULT_COPY.
 * reasonChips defaults to the standard chip lists.
 * Does NOT write to the DB if no row exists.
 */
export async function getSettings(shop) {
  const row = await db.shopSettings.findUnique({ where: { shop } });

  const defaultReasonChips = {
    pass: DEFAULT_PASS_CHIPS.map(c => ({ ...c })),
    maybe: DEFAULT_MAYBE_CHIPS.map(c => ({ ...c })),
  };

  if (!row) {
    return {
      enabled:              false,
      boardExpiryDays:      30,
      maxItemsPerBoard:     12,
      maxSharesPerDay:      10,
      notificationsEnabled: true,
      askReasons:           true,
      excludeTag:           "pvb-exclude",
      buyerTag:             "pvb-board-buyer",
      copy:                 { ...DEFAULT_COPY },
      reasonChips:          defaultReasonChips,
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

  // Merge reasonChips: use saved if valid, else defaults
  let reasonChips = defaultReasonChips;
  if (row.reasonChips && typeof row.reasonChips === "object") {
    const saved = row.reasonChips;
    if (Array.isArray(saved.pass) && Array.isArray(saved.maybe)) {
      reasonChips = {
        pass: saved.pass,
        maybe: saved.maybe,
      };
    }
  }

  return { ...row, copy: mergedCopy, reasonChips };
}

/**
 * Get setup guide state, merging saved with defaults.
 */
export async function getSetupGuide(shop) {
  const row = await db.shopSettings.findUnique({
    where: { shop },
    select: { setupGuide: true },
  });
  const saved = row?.setupGuide || {};
  return {
    ...DEFAULT_SETUP_GUIDE,
    ...saved,
    steps: {
      ...DEFAULT_SETUP_GUIDE.steps,
      ...(saved.steps || {}),
    },
  };
}

/**
 * Update a single setup guide step.
 */
export async function updateSetupGuideStep(shop, stepKey, value) {
  const current = await getSetupGuide(shop);
  current.steps[stepKey] = value;
  return db.shopSettings.update({
    where: { shop },
    data: { setupGuide: current },
  });
}

/**
 * Dismiss the setup guide.
 */
export async function dismissSetupGuide(shop) {
  const current = await getSetupGuide(shop);
  current.dismissed = true;
  return db.shopSettings.update({
    where: { shop },
    data: { setupGuide: current },
  });
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
  data.notificationsEnabled = parseBool(input.notificationsEnabled);
  data.askReasons           = parseBool(input.askReasons);

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

  // buyerTag — same rules as excludeTag, empty = don't tag
  const buyerTagVal = String(input.buyerTag ?? "").trim();
  if (buyerTagVal.length > LIMITS.excludeTagMaxLength) {
    errors.buyerTag = `Must be ${LIMITS.excludeTagMaxLength} characters or fewer.`;
  } else if (buyerTagVal !== "" && !/^[a-zA-Z0-9_-]+$/.test(buyerTagVal)) {
    errors.buyerTag = "Only letters, numbers, hyphens, and underscores are allowed.";
  } else {
    data.buyerTag = buyerTagVal;
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

/**
 * Validate general settings (a subset of fields).
 * @param {Record<string, unknown>} input
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateGeneralSettings(input) {
  const errors = {};
  const data = {};

  // Boolean
  const parseBool = (v) => v === "on" || v === "true" || v === true;
  data.enabled = parseBool(input.enabled);

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
  data.boardExpiryDays = validateInt("boardExpiryDays", input.boardExpiryDays, LIMITS.boardExpiryDays);
  data.maxItemsPerBoard = validateInt("maxItemsPerBoard", input.maxItemsPerBoard, LIMITS.maxItemsPerBoard);
  data.maxSharesPerDay = validateInt("maxSharesPerDay", input.maxSharesPerDay, LIMITS.maxSharesPerDay);

  // excludeTag
  const tag = String(input.excludeTag ?? "").trim();
  if (tag.length > LIMITS.excludeTagMaxLength) {
    errors.excludeTag = `Must be ${LIMITS.excludeTagMaxLength} characters or fewer.`;
  } else if (tag !== "" && !/^[a-zA-Z0-9_-]+$/.test(tag)) {
    errors.excludeTag = "Only letters, numbers, hyphens, and underscores are allowed.";
  } else {
    data.excludeTag = tag;
  }

  return { data, errors };
}

/**
 * Validate vote page copy settings.
 * @param {Record<string, unknown>} input
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateVotePageSettings(input) {
  const errors = {};
  const copy = {};

  for (const key of Object.keys(DEFAULT_COPY)) {
    const val = String(input[`copy.${key}`] ?? "").trim();
    if (val.length > LIMITS.copyMaxLength) {
      errors[`copy.${key}`] = `Must be ${LIMITS.copyMaxLength} characters or fewer.`;
    } else {
      copy[key] = val;
    }
  }

  // askReasons toggle
  const parseBool = (v) => v === "on" || v === "true" || v === true;
  const data = {
    copy,
    askReasons: parseBool(input.askReasons),
  };

  return { data, errors };
}

/**
 * Validate notification settings.
 * @param {Record<string, unknown>} input
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateNotificationSettings(input) {
  const errors = {};
  const data = {};

  const parseBool = (v) => v === "on" || v === "true" || v === true;
  data.notificationsEnabled = parseBool(input.notificationsEnabled);

  return { data, errors };
}

/**
 * Validate customer/tagging settings.
 * @param {Record<string, unknown>} input
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateCustomerSettings(input) {
  const errors = {};
  const data = {};

  const buyerTagVal = String(input.buyerTag ?? "").trim();
  if (buyerTagVal.length > LIMITS.excludeTagMaxLength) {
    errors.buyerTag = `Must be ${LIMITS.excludeTagMaxLength} characters or fewer.`;
  } else if (buyerTagVal !== "" && !/^[a-zA-Z0-9_-]+$/.test(buyerTagVal)) {
    errors.buyerTag = "Only letters, numbers, hyphens, and underscores are allowed.";
  } else {
    data.buyerTag = buyerTagVal;
  }

  return { data, errors };
}

// Chip validation limits
const CHIP_LIMITS = {
  maxActivePerList: 8,
  labelMinLength: 2,
  labelMaxLength: 24,
  codeMaxLength: 30,
};

// Valid chip label pattern: letters, numbers, spaces, & - '
const CHIP_LABEL_PATTERN = /^[a-zA-Z0-9 &'-]+$/;

/**
 * Generate a unique code from label. Lowercase, a-z0-9_, max 30 chars.
 * Adds numeric suffix if code already exists in the list.
 */
function generateCode(label, existingCodes) {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, CHIP_LIMITS.codeMaxLength - 2); // leave room for suffix
  if (!base) base = "chip";

  let code = base;
  let suffix = 2;
  while (existingCodes.has(code)) {
    code = `${base}_${suffix}`;
    suffix++;
    if (suffix > 99) break; // safety
  }
  return code.slice(0, CHIP_LIMITS.codeMaxLength);
}

/**
 * Validate and transform reasonChips input.
 * @param {object} input - { pass: [...], maybe: [...] }
 * @param {object} currentChips - Existing chips (to preserve codes)
 * @returns {{ data: object, errors: Record<string, string> }}
 */
export function validateReasonChips(input, currentChips) {
  const errors = {};
  const data = { pass: [], maybe: [] };

  for (const listKey of ["pass", "maybe"]) {
    const inputList = input?.[listKey];
    if (!Array.isArray(inputList)) {
      errors[`reasonChips.${listKey}`] = "Must be an array.";
      continue;
    }

    // Build map of existing codes for this list
    const existingMap = new Map();
    for (const chip of currentChips?.[listKey] || []) {
      if (chip.code) existingMap.set(chip.code, chip);
    }

    const newCodes = new Set();
    let activeCount = 0;

    for (let i = 0; i < inputList.length; i++) {
      const chip = inputList[i];
      const prefix = `reasonChips.${listKey}[${i}]`;

      // Validate label
      const label = String(chip?.label ?? "").trim();
      if (label.length < CHIP_LIMITS.labelMinLength) {
        errors[`${prefix}.label`] = `Label must be at least ${CHIP_LIMITS.labelMinLength} characters.`;
        continue;
      }
      if (label.length > CHIP_LIMITS.labelMaxLength) {
        errors[`${prefix}.label`] = `Label must be ${CHIP_LIMITS.labelMaxLength} characters or fewer.`;
        continue;
      }
      if (!CHIP_LABEL_PATTERN.test(label)) {
        errors[`${prefix}.label`] = "Only letters, numbers, spaces, &, -, and ' are allowed.";
        continue;
      }

      // Determine code: use existing if provided and valid, else generate
      let code = chip?.code;
      const isNew = !code || !existingMap.has(code);

      if (isNew) {
        // New chip: generate code
        code = generateCode(label, new Set([...existingMap.keys(), ...newCodes]));
      }

      // Check code uniqueness in this list
      if (newCodes.has(code)) {
        errors[`${prefix}.code`] = "Duplicate code in list.";
        continue;
      }
      newCodes.add(code);

      // Validate active
      const active = chip?.active === true || chip?.active === "true";
      if (active) {
        activeCount++;
        if (activeCount > CHIP_LIMITS.maxActivePerList) {
          errors[`${prefix}.active`] = `Maximum ${CHIP_LIMITS.maxActivePerList} active chips per list.`;
          continue;
        }
      }

      data[listKey].push({ code, label, active });
    }
  }

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


/**
 * Tag past board buyers: backfill customerId on order events and tag customers.
 * Batches in 50s. Never throws; returns counts.
 * @param {string} shop
 * @param {object} admin - Shopify Admin API client
 * @returns {Promise<{ updated: number, guests: number, failed: number }>}
 */
export async function tagPastBoardBuyers(shop, admin) {
  const settings = await getSettings(shop);
  if (!settings.buyerTag) {
    return { updated: 0, guests: 0, failed: 0, skipped: true };
  }

  // Find order events missing customerId
  const events = await db.analyticsEvent.findMany({
    where: {
      shop,
      type: "order_from_board",
      orderId: { not: null },
      customerId: null,
    },
    select: { id: true, orderId: true },
  });

  if (events.length === 0) {
    return { updated: 0, guests: 0, failed: 0 };
  }

  let updated = 0;
  let guests = 0;
  let failed = 0;

  // Batch in 50s
  for (let i = 0; i < events.length; i += 50) {
    const batch = events.slice(i, i + 50);
    const orderIds = batch.map((e) => e.orderId);

    try {
      // Fetch orders with customer IDs
      const response = await admin.graphql(
        `query GetOrderCustomers($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              customer { id }
            }
          }
        }`,
        { variables: { ids: orderIds } }
      );

      const json = await response.json();
      const nodes = json.data?.nodes || [];

      for (const node of nodes) {
        if (!node?.id) continue;
        const event = batch.find((e) => e.orderId === node.id);
        if (!event) continue;

        const customerId = node.customer?.id || null;

        if (customerId) {
          // Update event with customerId
          await db.analyticsEvent.update({
            where: { id: event.id },
            data: { customerId },
          });

          // Tag the customer using helper (checks userErrors)
          const tagResult = await addBuyerTag(admin, customerId, settings.buyerTag);
          if (tagResult.ok) {
            updated++;
          } else {
            failed++;
          }
        } else {
          // Guest checkout: mark as processed with empty string so we don't
          // re-query this order. Queries must exclude both null and "".
          await db.analyticsEvent.update({
            where: { id: event.id },
            data: { customerId: "" },
          });
          guests++;
        }
      }
    } catch {
      failed += batch.length;
    }
  }

  return { updated, guests, failed };
}
