import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import {
  getSettings,
  validateNotificationSettings,
  saveSettings,
  saveKlaviyoKey,
  removeKlaviyoKey,
} from "../models/settings.server.js";
import { getEncryptionKey } from "../utils/crypto.server.js";
import { validateKlaviyoKey, sendTestEvent, getNotificationStats } from "../services/notify.server.js";
import { log } from "../utils/log.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const hasEncryptionKey = !!getEncryptionKey();
  const notifyStats = await getNotificationStats(session.shop);

  return {
    notificationsEnabled: settings.notificationsEnabled,
    klaviyoKeyLast4: settings.klaviyoKeyLast4,
    klaviyoConnectedAt: settings.klaviyoConnectedAt,
    hasEncryptionKey,
    notifyStats,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Handle Klaviyo key removal
  if (intent === "removeKlaviyoKey") {
    await removeKlaviyoKey(session.shop);
    log.info("klaviyo.key_removed", { shop: session.shop });
    return Response.json({ ok: true, klaviyoRemoved: true });
  }

  // Handle test event
  if (intent === "testKlaviyo") {
    const testEmail = formData.get("testEmail");
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return Response.json(
        { errors: { testEmail: "Enter a valid email address." } },
        { status: 400 }
      );
    }
    const result = await sendTestEvent(session.shop, testEmail);
    if (result.ok) {
      return Response.json({ ok: true, testSent: true });
    }
    return Response.json(
      { errors: { testEmail: `Couldn't send: ${result.code}` } },
      { status: 400 }
    );
  }

  // Handle main form submission
  const input = {
    notificationsEnabled: formData.get("notificationsEnabled"),
  };
  const { data, errors } = validateNotificationSettings(input);

  // Handle Klaviyo key save
  const klaviyoKey = formData.get("klaviyoKey")?.trim();
  let klaviyoError = null;

  if (klaviyoKey) {
    if (!getEncryptionKey()) {
      klaviyoError = "Server missing APP_ENCRYPTION_KEY.";
    } else {
      const validation = await validateKlaviyoKey(klaviyoKey);
      if (!validation.ok) {
        log.info("klaviyo.key_invalid", { shop: session.shop });
        klaviyoError = "Klaviyo didn't accept this key.";
      }
    }
  }

  if (klaviyoError) {
    errors.klaviyoKey = klaviyoError;
  }

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.notifications_saved", { shop: session.shop });

  // Save Klaviyo key if provided and valid
  if (klaviyoKey) {
    await saveKlaviyoKey(session.shop, klaviyoKey);
    log.info("klaviyo.key_saved", { shop: session.shop });
  }

  return Response.json({ ok: true, savedAt: Date.now() });
};

export default function NotificationSettings() {
  const settings = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const errors = actionData?.errors ?? {};
  const fetcherErrors = fetcher.data?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

  const [testEmail, setTestEmail] = useState("");

  const isKlaviyoConnected = !!settings.klaviyoKeyLast4;

  useEffect(() => {
    if (actionData?.ok) {
      if (actionData?.testSent) {
        shopify.toast.show("Test event sent to Klaviyo");
      } else if (actionData?.klaviyoRemoved) {
        shopify.toast.show("Klaviyo key removed");
      } else {
        shopify.toast.show("Settings saved");
      }
    }
  }, [actionData?.savedAt, actionData?.ok, actionData?.testSent, actionData?.klaviyoRemoved, shopify]);

  // Handle fetcher responses (remove key, test event)
  useEffect(() => {
    if (fetcher.data?.ok) {
      if (fetcher.data?.klaviyoRemoved) {
        shopify.toast.show("Klaviyo key removed");
      } else if (fetcher.data?.testSent) {
        shopify.toast.show("Test event sent to Klaviyo");
      }
    }
  }, [fetcher.data, shopify]);

  const handleRemoveKey = () => {
    fetcher.submit({ intent: "removeKlaviyoKey" }, { method: "post" });
  };

  const handleTestEvent = () => {
    fetcher.submit({ intent: "testKlaviyo", testEmail }, { method: "post" });
  };

  return (
    <Form method="post" data-save-bar>
      <s-page
        heading="Notifications"
        back-action={JSON.stringify({ url: "/app/settings" })}
      >
        <style>{`
          .pvb-settings-layout { display: grid; grid-template-columns: 280px 1fr; gap: 40px; }
          @media (max-width: 800px) { .pvb-settings-layout { grid-template-columns: 1fr; gap: 16px; } }
          .pvb-settings-help h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #202223; }
          .pvb-settings-help p { font-size: 13px; color: #6d7175; line-height: 1.5; margin: 0; }
          .pvb-settings-fields { display: flex; flex-direction: column; gap: 16px; }
          .pvb-email-stats { display: flex; gap: 24px; margin-top: 8px; font-size: 13px; color: #6d7175; }
          .pvb-email-stat { display: flex; flex-direction: column; }
          .pvb-email-stat-value { font-size: 20px; font-weight: 600; color: #202223; }
        `}</style>

        {!settings.hasEncryptionKey && (
          <s-banner tone="critical" heading="App not fully set up">
            The app isn&apos;t fully set up yet. Contact the developer.
          </s-banner>
        )}

        {hasErrors && (
          <s-banner tone="critical" heading="Settings weren't saved">
            Fix the highlighted fields and save again.
          </s-banner>
        )}

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Voting Done Email</h3>
              <p>
                Send an email to the shopper when their partner finishes voting.
                The email is sent via Klaviyo so you can customize the design.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-switch
                label="Email the shopper when voting is done"
                name="notificationsEnabled"
                checked={settings.notificationsEnabled || undefined}
              />

              <s-text-field
                label="Klaviyo metric name"
                value="PVB Voting Completed"
                readonly
                details="Use this metric name when creating your flow trigger in Klaviyo."
              />
              <s-button
                variant="plain"
                onClick={() => {
                  navigator.clipboard.writeText("PVB Voting Completed");
                  shopify.toast.show("Metric name copied");
                }}
              >
                Copy metric name
              </s-button>
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Klaviyo Connection</h3>
              <p>
                Connect your Klaviyo account to send voting-done emails. Create
                a private API key with Events: Write and Accounts: Read scopes.
              </p>
            </div>
            <div className="pvb-settings-fields">
              {isKlaviyoConnected ? (
                <>
                  <s-banner tone="success" heading="Klaviyo connected">
                    Key ending in {settings.klaviyoKeyLast4}
                  </s-banner>
                  <s-button
                    tone="critical"
                    variant="plain"
                    onClick={handleRemoveKey}
                    disabled={fetcher.state !== "idle" || undefined}
                  >
                    Remove key
                  </s-button>
                  <s-text-field
                    label="Test email"
                    name="testEmail"
                    type="email"
                    value={testEmail}
                    error={fetcherErrors.testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    details="Send a test event to preview the email in Klaviyo."
                  />
                  <s-button
                    onClick={handleTestEvent}
                    disabled={fetcher.state !== "idle" || !testEmail || undefined}
                  >
                    Send Test Event
                  </s-button>
                </>
              ) : (
                <s-text-field
                  label="Klaviyo private API key"
                  name="klaviyoKey"
                  type="password"
                  value=""
                  error={errors.klaviyoKey}
                  details="Create a private key in Klaviyo with Events: Write and Accounts: Read scopes."
                  disabled={!settings.hasEncryptionKey || undefined}
                />
              )}
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Email Health</h3>
              <p>
                Status of voting-done emails in the last 30 days. Failed emails
                are retried automatically up to 3 times.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <div className="pvb-email-stats">
                <div className="pvb-email-stat">
                  <span className="pvb-email-stat-value">{settings.notifyStats.sent}</span>
                  <span>Sent</span>
                </div>
                <div className="pvb-email-stat">
                  <span className="pvb-email-stat-value">{settings.notifyStats.pending}</span>
                  <span>Pending</span>
                </div>
                <div className="pvb-email-stat">
                  <span className="pvb-email-stat-value">{settings.notifyStats.failed}</span>
                  <span>Failed</span>
                </div>
              </div>
            </div>
          </div>
        </s-section>
      </s-page>
    </Form>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
