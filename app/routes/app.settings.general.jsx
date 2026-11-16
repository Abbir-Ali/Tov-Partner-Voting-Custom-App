import { useEffect } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import { LIMITS } from "../models/settings.shared.js";
import { getSettings, validateGeneralSettings, saveSettings } from "../models/settings.server.js";
import { syncStorefrontConfig } from "../services/storefront-config.server.js";
import { log } from "../utils/log.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    enabled: settings.enabled,
    boardExpiryDays: settings.boardExpiryDays,
    maxItemsPerBoard: settings.maxItemsPerBoard,
    maxSharesPerDay: settings.maxSharesPerDay,
    excludeTag: settings.excludeTag,
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const input = {
    enabled: formData.get("enabled"),
    boardExpiryDays: formData.get("boardExpiryDays"),
    maxItemsPerBoard: formData.get("maxItemsPerBoard"),
    maxSharesPerDay: formData.get("maxSharesPerDay"),
    excludeTag: formData.get("excludeTag"),
  };

  const { data, errors } = validateGeneralSettings(input);

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.general_saved", { shop: session.shop });

  // Sync storefront config
  const syncResult = await syncStorefrontConfig(admin, session.shop);
  const syncWarning = !syncResult.ok;

  return Response.json({ ok: true, savedAt: Date.now(), syncWarning });
};

export default function GeneralSettings() {
  const settings = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const errors = actionData?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(
        actionData?.syncWarning
          ? "Settings saved (storefront sync failed)"
          : "Settings saved"
      );
    }
  }, [actionData?.savedAt, actionData?.ok, actionData?.syncWarning, shopify]);

  return (
    <Form method="post" data-save-bar>
      <s-page
        heading="General"
        back-action={JSON.stringify({ url: "/app/settings" })}
      >
        <style>{`
          .pvb-settings-layout { display: grid; grid-template-columns: 280px 1fr; gap: 40px; }
          @media (max-width: 800px) { .pvb-settings-layout { grid-template-columns: 1fr; gap: 16px; } }
          .pvb-settings-help { }
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
              <h3>Storefront Status</h3>
              <p>
                Turn the feature on or off for all shoppers. When off, the Save
                to Board button is hidden.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-switch
                label="Enable Partner Voting Board on the storefront"
                name="enabled"
                checked={settings.enabled || undefined}
              />
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Board Limits</h3>
              <p>
                Control how long boards stay active, how many pieces each board
                can hold, and how many boards a shopper can share per day.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-number-field
                label="Board expiry (days after sharing)"
                name="boardExpiryDays"
                min={LIMITS.boardExpiryDays[0]}
                max={LIMITS.boardExpiryDays[1]}
                step={1}
                value={String(settings.boardExpiryDays)}
                error={errors.boardExpiryDays}
              />
              <s-number-field
                label="Max pieces per board"
                name="maxItemsPerBoard"
                min={LIMITS.maxItemsPerBoard[0]}
                max={LIMITS.maxItemsPerBoard[1]}
                step={1}
                value={String(settings.maxItemsPerBoard)}
                error={errors.maxItemsPerBoard}
              />
              <s-number-field
                label="Max shares per shopper per day"
                name="maxSharesPerDay"
                min={LIMITS.maxSharesPerDay[0]}
                max={LIMITS.maxSharesPerDay[1]}
                step={1}
                value={String(settings.maxSharesPerDay)}
                error={errors.maxSharesPerDay}
              />
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Exclusions</h3>
              <p>
                Products with this tag won&apos;t show the Save to Board button.
                Gift cards are always excluded.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-text-field
                label="Exclude tag"
                name="excludeTag"
                value={settings.excludeTag}
                error={errors.excludeTag}
              />
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
