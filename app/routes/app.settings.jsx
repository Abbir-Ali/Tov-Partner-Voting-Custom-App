import { useEffect } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import { DEFAULT_COPY, LIMITS } from "../models/settings.shared.js";
import {
  getSettings,
  validateSettings,
  saveSettings,
} from "../models/settings.server.js";
import { syncStorefrontConfig } from "../services/storefront-config.server.js";
import { log } from "../utils/log.server.js";

// Labels and help text for vote-page copy fields.
const COPY_FIELDS = [
  {
    key:   "voteHeadline",
    label: "Vote Page Headline",
    help:  "Available: {shopper}",
  },
  {
    key:   "voteIntro",
    label: "Vote Page Introduction",
    help:  "Available: {shopper}, {count}",
  },
  { key: "loveLabel",  label: "Love It Label",  help: null },
  { key: "maybeLabel", label: "Maybe Label",     help: null },
  { key: "passLabel",  label: "Pass Label",      help: null },
  {
    key:   "thanksHeadline",
    label: "Thank You Headline",
    help:  "Available: {partner}",
  },
  {
    key:   "thanksBody",
    label: "Thank You Message",
    help:  "Available: {shopper}",
  },
  { key: "expiredHeadline", label: "Expired Board Headline", help: null },
  {
    key:   "expiredBody",
    label: "Expired Board Message",
    help:  "Available: {shopper}",
  },
];

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return getSettings(session.shop);
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Build flat input object from formData.
  const input = {
    enabled:              formData.get("enabled"),
    abTestEnabled:        formData.get("abTestEnabled"),
    notificationsEnabled: formData.get("notificationsEnabled"),
    abTestPercent:        formData.get("abTestPercent"),
    boardExpiryDays:      formData.get("boardExpiryDays"),
    maxItemsPerBoard:     formData.get("maxItemsPerBoard"),
    maxSharesPerDay:      formData.get("maxSharesPerDay"),
    excludeTag:           formData.get("excludeTag"),
  };
  for (const key of Object.keys(DEFAULT_COPY)) {
    input[`copy.${key}`] = formData.get(`copy.${key}`);
  }

  const { data, errors } = validateSettings(input);

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.saved", { shop: session.shop });

  // Sync storefront config to app metafield (theme extensions read this).
  const syncResult = await syncStorefrontConfig(admin, session.shop);
  const syncWarning = !syncResult.ok;

  // savedAt is unique per save so the toast fires on every save.
  return Response.json({ ok: true, savedAt: Date.now(), syncWarning });
};

// ─── Component ───────────────────────────────────────────────────────────────
//
// React 18 sets JSX props on custom elements as HTML attributes only — it
// never touches DOM properties. Polaris web components expose `value` and
// `checked` as reflected HTML attributes, so we must use those directly.
// `defaultValue` / `defaultChecked` are DOM properties only and React 18
// will silently ignore them on custom elements.
//
// Switch pattern: `checked={x || undefined}` — when x is false, `undefined`
// causes React to omit the attribute entirely. Writing checked="false" would
// still count as checked because attribute presence is what matters in Lit
// boolean attributes.
//
// No key= remount on the Form: data-save-bar tracks the specific DOM node it
// was first bound to. Unmounting and remounting the form (via key change)
// leaves the save bar bound to the old detached node, so subsequent saves
// fire submit on a ghost element that React Router never sees. Instead, after
// a successful save the loader revalidates and React updates the value/checked
// attributes in-place on the existing DOM nodes.

export default function SettingsPage() {
  const settings   = useLoaderData();
  const actionData = useActionData();
  const shopify    = useAppBridge();
  const errors     = actionData?.errors ?? {};
  const hasErrors  = Object.keys(errors).length > 0;

  // Toast fires on every clean save. actionData?.savedAt is unique each time
  // (Date.now()), so the effect reliably re-fires even on back-to-back saves.
  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData?.syncWarning
        ? "Settings saved (storefront sync failed)"
        : "Settings saved"
      );
    }
  }, [actionData?.savedAt, actionData?.ok, actionData?.syncWarning, shopify]);

  return (
    <Form method="post" data-save-bar>
      <s-page heading="Settings">

        {/* Sync warning banner */}
        {actionData?.syncWarning && (
          <s-banner tone="warning" heading="Storefront didn't update">
            Settings saved, but the storefront config didn&apos;t sync. Save again to retry.
          </s-banner>
        )}

        {/* Error banner — shown when the action returns validation errors */}
        {hasErrors && (
          <s-banner tone="critical" heading="Settings weren't saved">
            Fix the highlighted fields and save again.
          </s-banner>
        )}

        {/* ── a) Status ─────────────────────────────────────────────────── */}
        <s-section heading="Status">
          {!settings.enabled && (
            <s-banner tone="warning" heading="Feature disabled">
              The share button is hidden for all shoppers.
            </s-banner>
          )}
          <s-switch
            label="Enable Partner Voting Board on the storefront"
            name="enabled"
            checked={settings.enabled || undefined}
          />
        </s-section>

        {/* ── b) A/B Test ───────────────────────────────────────────────── */}
        <s-section heading="A/B Test">
          <s-switch
            label="Enable A/B test"
            name="abTestEnabled"
            checked={settings.abTestEnabled || undefined}
          />
          <s-number-field
            label="Percent of visitors who see the share button"
            name="abTestPercent"
            min={LIMITS.abTestPercent[0]}
            max={LIMITS.abTestPercent[1]}
            step={1}
            value={String(settings.abTestPercent)}
            error={errors.abTestPercent}
          />
        </s-section>

        {/* ── c) Boards ─────────────────────────────────────────────────── */}
        <s-section heading="Boards">
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
          <s-text-field
            label="Exclude tag"
            name="excludeTag"
            value={settings.excludeTag}
            details="Products with this tag can't be added to boards. Gift cards are always excluded."
            error={errors.excludeTag}
          />
        </s-section>

        {/* ── d) Notifications ──────────────────────────────────────────── */}
        <s-section heading="Notifications">
          <s-switch
            label="Email the shopper when voting is done"
            name="notificationsEnabled"
            checked={settings.notificationsEnabled || undefined}
          />
        </s-section>

        {/* ── e) Vote Page Copy ─────────────────────────────────────────── */}
        <s-section heading="Vote Page Copy">
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
        </s-section>

      </s-page>
    </Form>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
