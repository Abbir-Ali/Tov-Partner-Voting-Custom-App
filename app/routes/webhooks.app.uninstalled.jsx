import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Shopify deletes app metafields on uninstall, so reset sync status.
  // Safe to run even if settings row doesn't exist or was already reset.
  await db.shopSettings.updateMany({
    where: { shop },
    data: { storefrontSyncedVersion: null },
  });

  return new Response();
};
