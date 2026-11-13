/**
 * Web Pixel registration service.
 * Creates or updates the PVB Web Pixel for the shop.
 */
import db from "../db.server.js";
import { log } from "../utils/log.server.js";

// Pixel syncs every 7 days
const PIXEL_SYNC_DAYS = 7;

/**
 * Log GraphQL errors (top-level or userErrors).
 * Never logs full response body.
 */
function logGraphQLErrors(shop, operation, json) {
  // Top-level GraphQL errors
  if (json.errors?.length > 0) {
    const errs = json.errors.map((e) => ({
      code: e.extensions?.code || "GRAPHQL_ERROR",
      message: e.message,
    }));
    log.error("pixel.failed", { shop, operation, errors: errs });
    return errs[0].code;
  }
  return null;
}

/**
 * Log userErrors from a mutation response.
 */
function logUserErrors(shop, operation, userErrors) {
  if (userErrors?.length > 0) {
    const errs = userErrors.map((e) => ({
      code: e.code,
      field: e.field,
      message: e.message,
    }));
    log.error("pixel.failed", { shop, operation, userErrors: errs });
    return userErrors[0].code || "mutation_failed";
  }
  return null;
}

/**
 * Query the existing web pixel for this app.
 * Returns null if no pixel exists (handles "No web pixel was found" error).
 * @returns {Promise<{id: string, settings: string} | null>}
 */
async function getExistingPixel(admin, shop) {
  try {
    const res = await admin.graphql(`
      query {
        webPixel {
          id
          settings
        }
      }
    `);
    const json = await res.json();

    // "No web pixel was found for this app" is a normal case, not an error
    if (json.errors?.length > 0) {
      const noPixelError = json.errors.some(
        (e) => e.message?.includes("No web pixel was found")
      );
      if (noPixelError) {
        log.info("pixel.lookup", { shop, result: "none_exists" });
        return null;
      }
      // Other GraphQL errors - log and return null to try create
      logGraphQLErrors(shop, "lookup", json);
      return null;
    }

    return json.data?.webPixel || null;
  } catch (err) {
    // Network error during lookup - log and return null to try create
    log.warn("pixel.lookup_error", { shop, message: err.message });
    return null;
  }
}

/**
 * Sync the Web Pixel for a shop: create or update.
 * @param {object} admin - Shopify admin API client
 * @param {string} shop - Shop domain
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function syncPixel(admin, shop) {
  // Settings must match extension's [settings.fields] exactly
  const settings = JSON.stringify({ accountID: shop });

  try {
    // Check if pixel already exists
    let existing = await getExistingPixel(admin, shop);

    if (existing) {
      // Update existing pixel
      const updateRes = await admin.graphql(`
        mutation WebPixelUpdate($id: ID!, $settings: JSON!) {
          webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
            webPixel { id }
            userErrors { field message code }
          }
        }
      `, {
        variables: { id: existing.id, settings },
      });

      const updateJson = await updateRes.json();

      // Check for GraphQL errors
      const gqlCode = logGraphQLErrors(shop, "update", updateJson);
      if (gqlCode) return { ok: false, code: gqlCode };

      // Check for userErrors
      const userErrors = updateJson.data?.webPixelUpdate?.userErrors ?? [];
      const errCode = logUserErrors(shop, "update", userErrors);
      if (errCode) return { ok: false, code: errCode };

      // Save pixelId and mark sync success
      await db.shopSettings.upsert({
        where: { shop },
        update: { pixelId: existing.id, pixelSyncedAt: new Date() },
        create: { shop, pixelId: existing.id, pixelSyncedAt: new Date() },
      });

      log.info("pixel.connected", { shop, action: "updated" });
      return { ok: true };
    }

    // No existing pixel, create one
    const createRes = await admin.graphql(`
      mutation WebPixelCreate($settings: JSON!) {
        webPixelCreate(webPixel: { settings: $settings }) {
          webPixel { id }
          userErrors { field message code }
        }
      }
    `, {
      variables: { settings },
    });

    const createJson = await createRes.json();

    // Check for GraphQL errors
    const gqlCode = logGraphQLErrors(shop, "create", createJson);
    if (gqlCode) return { ok: false, code: gqlCode };

    // Check for userErrors
    const userErrors = createJson.data?.webPixelCreate?.userErrors ?? [];

    // Handle TAKEN: pixel already exists, re-query and update
    if (userErrors.some((e) => e.code === "TAKEN")) {
      log.info("pixel.taken", { shop });
      existing = await getExistingPixel(admin, shop);
      if (existing) {
        // Retry with update
        const retryRes = await admin.graphql(`
          mutation WebPixelUpdate($id: ID!, $settings: JSON!) {
            webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
              webPixel { id }
              userErrors { field message code }
            }
          }
        `, {
          variables: { id: existing.id, settings },
        });

        const retryJson = await retryRes.json();
        const retryGql = logGraphQLErrors(shop, "retry_update", retryJson);
        if (retryGql) return { ok: false, code: retryGql };

        const retryErrors = retryJson.data?.webPixelUpdate?.userErrors ?? [];
        const retryCode = logUserErrors(shop, "retry_update", retryErrors);
        if (retryCode) return { ok: false, code: retryCode };

        await db.shopSettings.upsert({
          where: { shop },
          update: { pixelId: existing.id, pixelSyncedAt: new Date() },
          create: { shop, pixelId: existing.id, pixelSyncedAt: new Date() },
        });

        log.info("pixel.connected", { shop, action: "updated_after_taken" });
        return { ok: true };
      }
    }

    // Other userErrors
    const errCode = logUserErrors(shop, "create", userErrors);
    if (errCode) return { ok: false, code: errCode };

    // Success: save new pixel id
    const newPixelId = createJson.data?.webPixelCreate?.webPixel?.id;
    await db.shopSettings.upsert({
      where: { shop },
      update: { pixelId: newPixelId, pixelSyncedAt: new Date() },
      create: { shop, pixelId: newPixelId, pixelSyncedAt: new Date() },
    });

    log.info("pixel.connected", { shop, action: "created" });
    return { ok: true };

  } catch (err) {
    // Network or unexpected error
    const code = err.name || err.code || "network_error";
    log.error("pixel.failed", { shop, code, message: err.message });
    return { ok: false, code };
  }
}

/**
 * Check if pixel needs sync (null or older than 7 days).
 * @param {string} shop
 * @returns {Promise<boolean>}
 */
export async function pixelNeedsSync(shop) {
  const row = await db.shopSettings.findUnique({
    where: { shop },
    select: { pixelSyncedAt: true },
  });
  if (!row?.pixelSyncedAt) return true;
  const ageMs = Date.now() - row.pixelSyncedAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return ageDays >= PIXEL_SYNC_DAYS;
}
