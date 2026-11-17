import db from "../db.server.js";
import { newToken } from "../utils/tokens.server.js";
import { BOARD_LIMITS } from "./board.shared.js";
import { pickAvatar } from "./avatars.shared.js";

export { BOARD_LIMITS };

// Helper to pick avatar for voter creation
function pickAvatarForVoter(seed, usedAvatars) {
  return pickAvatar(seed, usedAvatars);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Letters, spaces, hyphens, apostrophes only (any script).
const NAME_RE = /^[\p{L} '-]+$/u;

// Capitalize first letter if the whole string is lowercase
function capitalizeIfAllLower(str) {
  if (!str) return str;
  if (str === str.toLowerCase()) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  return str;
}

function normalizeGid(id) {
  if (typeof id !== "string") return null;
  const s = id.trim();
  if (s.startsWith("gid://shopify/ProductVariant/")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  return null;
}

// ─── Validate ────────────────────────────────────────────────────────────────

/**
 * Validate the JSON body from POST /api/boards.
 * Returns { data, errors } where errors is { field: message }.
 * TOV voice: warm, plain, no jargon.
 *
 * @param {object} body
 * @param {object} settings - ShopSettings row (or defaults)
 * @param {{ isLoggedIn?: boolean }} [opts]
 */
export function validateCreateInput(body, settings, { isLoggedIn = false } = {}) {
  const errors = {};
  const data   = {};

  if (!body || typeof body !== "object") {
    return { data: {}, errors: { _body: "Expected a JSON object." } };
  }

  // name — optional, defaults to "My Board"
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (rawName.length > BOARD_LIMITS.nameMax) {
    errors.name = `Keep the board name under ${BOARD_LIMITS.nameMax} characters.`;
  } else {
    data.name = rawName || "My Board";
  }

  // ownerFirstName — required, letters/spaces/hyphens/apostrophes
  const ownerFirstName = typeof body.ownerFirstName === "string"
    ? body.ownerFirstName.trim() : "";
  if (!ownerFirstName) {
    errors.ownerFirstName = "Your first name is required.";
  } else if (ownerFirstName.length > BOARD_LIMITS.firstNameMax) {
    errors.ownerFirstName = `Keep your name under ${BOARD_LIMITS.firstNameMax} characters.`;
  } else if (!NAME_RE.test(ownerFirstName)) {
    errors.ownerFirstName = "Only letters, spaces, hyphens, and apostrophes are allowed.";
  } else {
    data.ownerFirstName = capitalizeIfAllLower(ownerFirstName);
  }

  // voterNames — array of 1-5 names (new format) or partnerFirstName (legacy)
  const rawVoterNames = Array.isArray(body.voterNames) ? body.voterNames : null;
  const legacyPartner = typeof body.partnerFirstName === "string"
    ? body.partnerFirstName.trim() : "";

  if (rawVoterNames) {
    // New format: voterNames array
    const names = rawVoterNames
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter((n) => n.length > 0)
      .slice(0, 5);

    if (names.length === 0) {
      errors.voterNames = "Add at least one person's name.";
    } else {
      const seen = new Set();
      const validated = [];
      for (const name of names) {
        if (name.length > BOARD_LIMITS.firstNameMax) {
          errors.voterNames = `Keep names under ${BOARD_LIMITS.firstNameMax} characters.`;
          break;
        }
        if (!NAME_RE.test(name)) {
          errors.voterNames = "Only letters, spaces, hyphens, and apostrophes allowed.";
          break;
        }
        const lower = name.toLowerCase();
        if (seen.has(lower)) {
          errors.voterNames = "Use a different name for each person.";
          break;
        }
        seen.add(lower);
        validated.push(capitalizeIfAllLower(name));
      }
      if (!errors.voterNames) {
        data.voterNames = validated;
        data.partnerFirstName = validated[0]; // First name for backward compat
      }
    }
  } else if (legacyPartner) {
    // Legacy format: single partnerFirstName
    if (legacyPartner.length > BOARD_LIMITS.firstNameMax) {
      errors.partnerFirstName = `Keep your partner's name under ${BOARD_LIMITS.firstNameMax} characters.`;
    } else if (!NAME_RE.test(legacyPartner)) {
      errors.partnerFirstName = "Only letters, spaces, hyphens, and apostrophes allowed.";
    } else {
      data.partnerFirstName = capitalizeIfAllLower(legacyPartner);
      data.voterNames = [data.partnerFirstName];
    }
  } else {
    errors.partnerFirstName = "Your partner's first name is required.";
  }

  // note — optional
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > BOARD_LIMITS.noteMax) {
    errors.note = `Keep the note under ${BOARD_LIMITS.noteMax} characters.`;
  } else {
    data.note = note || null;
  }

  // ownerEmail — required when notifications are on OR the shopper is not logged in
  // (guests need an email for creator tracking even when notifications are off)
  const ownerEmail = typeof body.ownerEmail === "string"
    ? body.ownerEmail.trim().toLowerCase() : "";
  const emailRequired = settings.notificationsEnabled || !isLoggedIn;
  if (emailRequired) {
    if (!ownerEmail) {
      errors.ownerEmail = settings.notificationsEnabled
        ? "Add your email so we can let you know when voting is done."
        : "Add your email to share the board.";
    } else if (ownerEmail.length > BOARD_LIMITS.emailMax) {
      errors.ownerEmail = "That email address is too long.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) {
      errors.ownerEmail = "That doesn't look like a valid email address.";
    } else {
      data.ownerEmail = ownerEmail;
    }
  } else {
    data.ownerEmail = ownerEmail || null;
  }

  // items — 1..maxItemsPerBoard; normalize GIDs; dedupe
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    errors.items = "Add at least one piece to your board.";
  } else if (rawItems.length > settings.maxItemsPerBoard) {
    errors.items =
      `Your board can have up to ${settings.maxItemsPerBoard} pieces.`;
  } else {
    const seen    = new Set();
    const items   = [];
    let itemError = null;
    for (const item of rawItems) {
      const gid = normalizeGid(
        item && typeof item.variantId === "string" ? item.variantId : null
      );
      if (!gid) {
        itemError = "Each item needs a valid variantId.";
        break;
      }
      if (!seen.has(gid)) {
        seen.add(gid);
        items.push({ variantId: gid });
      }
    }
    if (itemError) {
      errors.items = itemError;
    } else {
      data.items = items;
    }
  }

  // groupVoting — optional boolean, but disabled if 5 personal voters
  const maxPersonalVoters = 5;
  const voterCount = data.voterNames ? data.voterNames.length : 1;
  if (body.groupVoting === true && voterCount >= maxPersonalVoters) {
    // Can't have group link if already at max personal voters
    data.groupVoting = false;
  } else {
    data.groupVoting = body.groupVoting === true;
  }

  // hidePrices — optional boolean
  data.hidePrices = body.hidePrices === true;

  // maxVoters — fixed at 5 (removed user input)
  data.maxVoters = 5;

  return { data, errors };
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a board (status SHARED) in a single transaction.
 * `data.items` must already be enriched with `productId` and `position`.
 *
 * @param {{ shop: string, data: object, customerId: string|null, settings: object }}
 * @returns {{ board: object, shareToken: string, ownerToken: string, groupToken: string|null }}
 */
export async function createBoard({ shop, data, customerId, settings }) {
  const ownerToken = newToken();
  const groupToken = data.groupVoting ? newToken() : null;
  const now        = new Date();
  const expiresAt  = new Date(
    now.getTime() + settings.boardExpiryDays * 24 * 60 * 60 * 1000
  );

  // Generate tokens for each voter name
  const voterTokens = (data.voterNames || [data.partnerFirstName]).map((name) => ({
    name,
    token: newToken(),
  }));

  const result = await db.$transaction(async (tx) => {
    if (!data.creatorKey) {
      throw new Error("createBoard called without data.creatorKey");
    }
    const newBoard = await tx.board.create({
      data: {
        shop,
        shareToken: voterTokens[0].token, // First voter's token for backward compat
        ownerToken,
        groupToken,
        creatorKey: data.creatorKey,
        customerId:      customerId ?? null,
        ownerFirstName:  data.ownerFirstName,
        ownerEmail:      data.ownerEmail ?? null,
        partnerFirstName: data.partnerFirstName,
        name:    data.name,
        note:    data.note ?? null,
        status:  "SHARED",
        sharedAt: now,
        expiresAt,
        hidePrices: data.hidePrices ?? false,
        maxVoters: data.maxVoters ?? 5,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            position:  item.position,
          })),
        },
      },
    });

    // Create personal voter for each name with unique avatars
    const usedAvatars = [];
    const voterData = [];
    for (const { name, token } of voterTokens) {
      const avatarKey = pickAvatarForVoter(`${newBoard.id}-${name}`, usedAvatars);
      usedAvatars.push(avatarKey);
      await tx.voter.create({
        data: {
          boardId: newBoard.id,
          token,
          firstName: name,
          kind: "PERSONAL",
          avatarKey,
        },
      });
      voterData.push({ name, token, avatarKey });
    }

    return { board: newBoard, voterData };
  });

  return {
    board: result.board,
    shareToken: voterTokens[0].token,
    ownerToken,
    groupToken,
    voterTokens: result.voterData,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Number of boards this creator shared in the last 24 hours.
 */
export async function countSharesToday(shop, ck) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return db.board.count({
    where: { shop, creatorKey: ck, createdAt: { gte: since } },
  });
}

/**
 * Returns the board with its items for the given share token.
 * Always filters by shop AND token to prevent token enumeration
 * across shops. Only SHARED and VOTED boards are returned so that
 * vote and results pages work, but drafts remain hidden.
 *
 * @returns {Promise<object|null>}
 */
export async function getBoardByShareToken(shop, token) {
  if (typeof token !== "string" || !token) return null;
  return db.board.findFirst({
    where: { shop, shareToken: token, status: { in: ["SHARED", "VOTED"] } },
    include: { items: { orderBy: { position: "asc" } } },
  });
}


/**
 * Returns the board with its items and voters for the given owner token.
 * Used by the results page. Always filters by shop AND token.
 * Only SHARED and VOTED boards are returned.
 *
 * @returns {Promise<object|null>}
 */
export async function getBoardByOwnerToken(shop, token) {
  if (typeof token !== "string" || !token) return null;
  return db.board.findFirst({
    where: { shop, ownerToken: token, status: { in: ["SHARED", "VOTED"] } },
    include: {
      items: { orderBy: { position: "asc" } },
      voters: {
        select: {
          id: true,
          token: true,
          firstName: true,
          avatarKey: true,
          completedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/**
 * Set partnerOpenedAt to now if it is currently null.
 * Uses a conditional update to avoid race conditions.
 *
 * @returns {Promise<boolean>} true if updated, false if already set
 */
export async function setPartnerOpenedAt(boardId) {
  const result = await db.board.updateMany({
    where: { id: boardId, partnerOpenedAt: null },
    data: { partnerOpenedAt: new Date() },
  });
  return result.count > 0;
}
