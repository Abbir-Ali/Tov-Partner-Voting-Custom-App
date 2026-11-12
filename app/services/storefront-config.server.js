import db from "../db.server.js";
import { getSettings } from "../models/settings.server.js";

// Bump this when the storefront config shape changes.
export const CONFIG_VERSION = 1;

/**
 * Syncs storefront config to the app metafield (theme extensions read this).
 * @param {object} admin - Shopify admin API client from authenticate
 * @param {string} shop - Shop domain
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function syncStorefrontConfig(admin, shop) {
  try {
    const settings = await getSettings(shop);

    // Get current app installation ID
    const appIdRes = await admin.graphql(`
      query { currentAppInstallation { id } }
    `);
    const appIdJson = await appIdRes.json();
    const appInstallationId = appIdJson.data?.currentAppInstallation?.id;

    if (!appInstallationId) {
      console.error("[storefront-config.sync] code=no_app_installation");
      await markSyncFailed(shop);
      return { ok: false, code: "no_app_installation" };
    }

    // Build config object
    const configValue = JSON.stringify({
      configVersion: CONFIG_VERSION,
      enabled: settings.enabled,
      maxItemsPerBoard: settings.maxItemsPerBoard,
      abTestEnabled: settings.abTestEnabled,
      abTestPercent: settings.abTestPercent,
      excludeTag: settings.excludeTag,
    });

    // Write to app metafield
    const syncRes = await admin.graphql(`
      mutation SyncConfigMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message code }
        }
      }
    `, {
      variables: {
        metafields: [{
          ownerId: appInstallationId,
          namespace: "pvb",
          key: "config",
          type: "json",
          value: configValue,
        }],
      },
    });

    const syncJson = await syncRes.json();
    const userErrors = syncJson.data?.metafieldsSet?.userErrors ?? [];

    if (userErrors.length > 0) {
      const code = userErrors[0].code ?? "metafield_error";
      console.error(`[storefront-config.sync] code=${code}`);
      await markSyncFailed(shop);
      return { ok: false, code };
    }

    // Mark sync success
    await markSyncSuccess(shop);
    return { ok: true };

  } catch (err) {
    const code = err.code ?? "unknown";
    console.error(`[storefront-config.sync] code=${code}`);
    await markSyncFailed(shop);
    return { ok: false, code };
  }
}

/**
 * Check if storefront config needs sync.
 * @param {string} shop - Shop domain
 * @returns {Promise<boolean>}
 */
export async function needsSync(shop) {
  const row = await db.shopSettings.findUnique({
    where: { shop },
    select: { storefrontSyncedVersion: true },
  });
  // No row means defaults; still needs sync
  if (!row) return true;
  return row.storefrontSyncedVersion !== CONFIG_VERSION;
}

async function markSyncSuccess(shop) {
  await db.shopSettings.upsert({
    where: { shop },
    update: {
      storefrontSyncedVersion: CONFIG_VERSION,
      storefrontSyncedAt: new Date(),
    },
    create: {
      shop,
      storefrontSyncedVersion: CONFIG_VERSION,
      storefrontSyncedAt: new Date(),
    },
  });
}

async function markSyncFailed(shop) {
  await db.shopSettings.upsert({
    where: { shop },
    update: { storefrontSyncedVersion: null },
    create: { shop, storefrontSyncedVersion: null },
  });
}
