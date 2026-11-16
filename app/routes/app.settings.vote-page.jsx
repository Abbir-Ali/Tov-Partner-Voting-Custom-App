import { useEffect } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import { DEFAULT_COPY, LIMITS } from "../models/settings.shared.js";
import {
  getSettings,
  validateVotePageSettings,
  saveSettings,
  getSetupGuide,
  updateSetupGuideStep,
} from "../models/settings.server.js";
import { log } from "../utils/log.server.js";

// Labels and help text for copy fields
const COPY_FIELDS = [
  { key: "voteHeadline", label: "Vote Page Headline", help: "Available: {shopper}" },
  { key: "voteIntro", label: "Vote Page Introduction", help: "Available: {shopper}, {count}" },
  { key: "loveLabel", label: "Love It Label", help: null },
  { key: "maybeLabel", label: "Maybe Label", help: null },
  { key: "passLabel", label: "Pass Label", help: null },
  { key: "thanksHeadline", label: "Thank You Headline", help: "Available: {partner}" },
  { key: "thanksBody", label: "Thank You Message", help: "Available: {shopper}" },
  { key: "expiredHeadline", label: "Expired Board Headline", help: null },
  { key: "expiredBody", label: "Expired Board Message", help: "Available: {shopper}" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    copy: settings.copy,
    askReasons: settings.askReasons,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const input = { askReasons: formData.get("askReasons") };
  for (const key of Object.keys(DEFAULT_COPY)) {
    input[`copy.${key}`] = formData.get(`copy.${key}`);
  }

  const { data, errors } = validateVotePageSettings(input);

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.vote_page_saved", { shop: session.shop });

  // Check if copy differs from defaults (for setup guide)
  const copyDiffers = Object.keys(DEFAULT_COPY).some(
    (k) => data.copy[k] && data.copy[k] !== DEFAULT_COPY[k]
  );
  if (copyDiffers) {
    const guide = await getSetupGuide(session.shop);
    if (!guide.steps.copyCustomized) {
      await updateSetupGuideStep(session.shop, "copyCustomized", true);
    }
  }

  return Response.json({ ok: true, savedAt: Date.now() });
};

export default function VotePageSettings() {
  const settings = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const errors = actionData?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [actionData?.savedAt, actionData?.ok, shopify]);

  return (
    <Form method="post" data-save-bar>
      <s-page
        heading="Vote Page"
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
              <h3>Headlines and Messages</h3>
              <p>
                Customize the text your partner sees on the vote page. Leave a
                field empty to use the default. Use placeholders like {"{shopper}"}
                for dynamic text.
              </p>
            </div>
            <div className="pvb-settings-fields">
              {COPY_FIELDS.map(({ key, label, help }) => (
                <s-text-field
                  key={key}
                  label={label}
                  name={`copy.${key}`}
                  placeholder={DEFAULT_COPY[key]}
                  value={
                    settings.copy[key] !== DEFAULT_COPY[key]
                      ? settings.copy[key]
                      : ""
                  }
                  details={help ?? undefined}
                  error={errors[`copy.${key}`]}
                  maxLength={LIMITS.copyMaxLength}
                />
              ))}
            </div>
          </div>
        </s-section>

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Reason Prompt</h3>
              <p>
                When on, partners can pick a reason after voting Maybe or Not
                For Us. You can customize the chips in Settings → Reason Chips.
              </p>
            </div>
            <div className="pvb-settings-fields">
              <s-switch
                label="Ask partner why on Maybe and Not For Us votes"
                name="askReasons"
                checked={settings.askReasons || undefined}
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
