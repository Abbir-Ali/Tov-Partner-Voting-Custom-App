import { Link, useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  syncStorefrontConfig,
  needsSync,
} from "../services/storefront-config.server.js";
import {
  sendPendingNotifications,
  hasFailedNotifications,
  getNotificationStats,
  retryFailedNotifications,
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

  // Get notification stats for the card
  const notifyStats = await getNotificationStats(shop);

  return { syncOk, needsKlaviyoKey, hasFailedNotifs, notifyStats };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "retryFailed") {
    const result = await retryFailedNotifications(session.shop);
    return Response.json({ ok: true, retryResult: result });
  }

  return Response.json({ ok: false }, { status: 400 });
};

export default function Index() {
  const { syncOk, needsKlaviyoKey, hasFailedNotifs, notifyStats } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const handleRetryFailed = () => {
    fetcher.submit({ intent: "retryFailed" }, { method: "post" });
  };

  // Show toast when retry completes
  if (fetcher.data?.ok && fetcher.data?.retryResult) {
    const { reset, sent } = fetcher.data.retryResult;
    shopify.toast.show(`Retried ${reset}, sent ${sent}`);
  }

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

      {/* Notification status card */}
      <s-section heading="Notification status">
        <s-paragraph>
          Sent (30 days): {notifyStats.sent} · Pending: {notifyStats.pending} · Failed: {notifyStats.failed}
        </s-paragraph>
        {notifyStats.failed > 0 && (
          <s-button
            onClick={handleRetryFailed}
            disabled={fetcher.state !== "idle" || undefined}
          >
            Retry Failed Now
          </s-button>
        )}
      </s-section>

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
