import { useEffect } from "react";
import { Form, useActionData, useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import {
  getSettings,
  validateCustomerSettings,
  saveSettings,
  tagPastBoardBuyers,
} from "../models/settings.server.js";
import { log } from "../utils/log.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return { buyerTag: settings.buyerTag };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Handle tag past buyers
  if (intent === "tagPastBuyers") {
    const result = await tagPastBoardBuyers(session.shop, admin);
    return Response.json({ ok: true, tagResult: result });
  }

  // Handle main form submission
  const input = {
    buyerTag: formData.get("buyerTag"),
  };
  const { data, errors } = validateCustomerSettings(input);

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.customers_saved", { shop: session.shop });

  return Response.json({ ok: true, savedAt: Date.now() });
};

export default function CustomerSettings() {
  const settings = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const errors = actionData?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (actionData?.ok) {
      if (actionData?.tagResult) {
        const r = actionData.tagResult;
        if (r.skipped) {
          shopify.toast.show("Set a buyer tag first");
        } else {
          shopify.toast.show(`Tagged ${r.updated}, ${r.guests} guests, ${r.failed} failed`);
        }
      } else {
        shopify.toast.show("Settings saved");
      }
    }
  }, [actionData?.savedAt, actionData?.ok, actionData?.tagResult, shopify]);

  // Handle fetcher responses
  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data?.tagResult) {
      const r = fetcher.data.tagResult;
      if (r.skipped) {
        shopify.toast.show("Set a buyer tag first");
      } else {
        shopify.toast.show(`Tagged ${r.updated}, ${r.guests} guests, ${r.failed} failed`);
      }
    }
  }, [fetcher.data, shopify]);

  const handleTagPast = () => {
    fetcher.submit({ intent: "tagPastBuyers" }, { method: "post" });
  };

  return (
    <Form method="post" data-save-bar>
      <s-page
        heading="Customers and Tags"
        back-action={JSON.stringify({ url: "/app/settings" })}
      >
        <style>{`
          .pvb-settings-layout { display: grid; grid-template-columns: 280px 1fr; gap: 40px; }
          @media (max-width: 800px) { .pvb-settings-layout { grid-template-columns: 1fr; gap: 16px; } }
          .pvb-settings-help h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #202223; }
          .pvb-settings-help p { font-size: 13px; color: #6d7175; line-height: 1.5; margin: 0; }
          .pvb-settings-fields { display: flex; flex-direction: column; gap: 16px; }
        `}</style>

        {hasErrors && (
          <s-banner tone="critical" heading="Settings weren't saved">
            Fix the highlighted fields and save again.
          </s-banner>
        )}

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Board Buyer Tag</h3>
              <p>
                Customers who complete an order from a shared board get this tag
                automatically. Use it to build customer segments in Shopify for
                marketing campaigns.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-text-field
                label="Board buyer tag"
                name="buyerTag"
                value={settings.buyerTag}
                error={errors.buyerTag}
                details="Leave empty to turn off tagging. Only letters, numbers, hyphens and underscores."
              />
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Backfill Tags</h3>
              <p>
                Tag customers who ordered from boards before you set up the tag.
                This only needs to be done once. Guest checkouts can&apos;t be tagged.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-button
                onClick={handleTagPast}
                disabled={fetcher.state !== "idle" || !settings.buyerTag || undefined}
              >
                Tag Past Board Buyers
              </s-button>
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
