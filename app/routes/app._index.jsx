import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  syncStorefrontConfig,
  needsSync,
} from "../services/storefront-config.server.js";
import {
  sendPendingNotifications,
  hasFailedNotifications,
} from "../services/notify.server.js";
import { getSettings } from "../models/settings.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Self-heal: sync storefront config if needed
  let syncOk = true;
  if (await needsSync(shop)) {
    const result = await syncStorefrontConfig(admin, shop);
    syncOk = result.ok;
  }

  // Self-heal: retry pending notifications
  await sendPendingNotifications(shop);

  // Check for banner conditions
  const settings = await getSettings(shop);
  const needsKlaviyoKey = settings.notificationsEnabled && !settings.klaviyoKeyEncrypted;
  const hasFailedNotifs = await hasFailedNotifications(shop);

  return { syncOk, needsKlaviyoKey, hasFailedNotifs };
};

export default function Index() {
  const { syncOk, needsKlaviyoKey, hasFailedNotifs } = useLoaderData();

  return (
    <s-page heading="Partner Voting Board">
      {!syncOk && (
        <s-banner tone="warning" heading="Storefront settings didn't sync">
          <Link to="/app/settings">Save Settings</Link> to try again.
        </s-banner>
      )}
      {needsKlaviyoKey && (
        <s-banner tone="info" heading="Connect Klaviyo">
          <Link to="/app/settings">Add your Klaviyo key</Link> so shoppers get an email when voting is done.
        </s-banner>
      )}
      {hasFailedNotifs && (
        <s-banner tone="warning" heading="Some emails couldn't be sent">
          Check your <Link to="/app/settings">Klaviyo key in Settings</Link>.
        </s-banner>
      )}
      <s-section>
        <s-paragraph>
          Shoppers share boards and partners vote on the storefront. Settings
          and stats will appear here.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
