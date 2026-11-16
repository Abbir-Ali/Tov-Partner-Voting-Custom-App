import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import { DEFAULT_COPY, LIMITS } from "../models/settings.shared.js";
import {
  getSettings,
  validateSettings,
  validateReasonChips,
  saveSettings,
  saveKlaviyoKey,
  removeKlaviyoKey,
  tagPastBoardBuyers,
} from "../models/settings.server.js";
import { validateKlaviyoKey, sendTestEvent } from "../services/notify.server.js";
import { getEncryptionKey } from "../utils/crypto.server.js";
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
  const settings = await getSettings(session.shop);
  const hasEncryptionKey = !!getEncryptionKey();
  return { ...settings, hasEncryptionKey };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Handle Klaviyo key removal
  if (intent === "removeKlaviyoKey") {
    await removeKlaviyoKey(session.shop);
    log.info("klaviyo.key_removed", { shop: session.shop });
    return Response.json({ ok: true, klaviyoRemoved: true });
  }

  // Handle tag past board buyers
  if (intent === "tagPastBuyers") {
    const result = await tagPastBoardBuyers(session.shop, admin);
    return Response.json({ ok: true, tagResult: result });
  }

  // Handle test event
  if (intent === "testKlaviyo") {
    const testEmail = formData.get("testEmail");
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return Response.json({
        errors: { testEmail: "Enter a valid email address." },
      }, { status: 400 });
    }
    const result = await sendTestEvent(session.shop, testEmail);
    if (result.ok) {
      return Response.json({ ok: true, testSent: true });
    }
    return Response.json({
      errors: { testEmail: `Couldn't send: ${result.code}` },
    }, { status: 400 });
  }

  // Build flat input object from formData.
  const input = {
    enabled:              formData.get("enabled"),
    notificationsEnabled: formData.get("notificationsEnabled"),
    askReasons:           formData.get("askReasons"),
    boardExpiryDays:      formData.get("boardExpiryDays"),
    maxItemsPerBoard:     formData.get("maxItemsPerBoard"),
    maxSharesPerDay:      formData.get("maxSharesPerDay"),
    excludeTag:           formData.get("excludeTag"),
    buyerTag:             formData.get("buyerTag"),
  };
  for (const key of Object.keys(DEFAULT_COPY)) {
    input[`copy.${key}`] = formData.get(`copy.${key}`);
  }

  const { data, errors } = validateSettings(input);

  // Parse and validate reasonChips
  const reasonChipsJson = formData.get("reasonChips");
  let reasonChipsInput = null;
  if (reasonChipsJson) {
    try {
      reasonChipsInput = JSON.parse(reasonChipsJson);
    } catch {
      errors.reasonChips = "Invalid JSON.";
    }
  }

  // Get current settings to preserve chip codes
  const currentSettings = await getSettings(session.shop);

  if (reasonChipsInput && !errors.reasonChips) {
    const chipResult = validateReasonChips(reasonChipsInput, currentSettings.reasonChips);
    Object.assign(errors, chipResult.errors);
    if (Object.keys(chipResult.errors).length === 0) {
      data.reasonChips = chipResult.data;
    }
  }

  // Handle Klaviyo key save (separate from other settings validation)
  const klaviyoKey = formData.get("klaviyoKey")?.trim();
  let klaviyoError = null;

  if (klaviyoKey) {
    // Check encryption key is available
    if (!getEncryptionKey()) {
      klaviyoError = "Server missing APP_ENCRYPTION_KEY.";
    } else {
      // Validate with Klaviyo API
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
  log.info("settings.saved", { shop: session.shop });

  // Save Klaviyo key if provided and valid
  if (klaviyoKey) {
    await saveKlaviyoKey(session.shop, klaviyoKey);
    log.info("klaviyo.key_saved", { shop: session.shop });
  }

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
  const fetcher    = useFetcher();
  const errors     = actionData?.errors ?? {};
  const hasErrors  = Object.keys(errors).length > 0;

  // Local state for test email
  const [testEmail, setTestEmail] = useState("");

  // Local state for reason chips (editable copy)
  const [passChips, setPassChips] = useState(() => settings.reasonChips?.pass || []);
  const [maybeChips, setMaybeChips] = useState(() => settings.reasonChips?.maybe || []);
  const [newPassLabel, setNewPassLabel] = useState("");
  const [newMaybeLabel, setNewMaybeLabel] = useState("");

  // Reset chips when settings reload (after save)
  useEffect(() => {
    if (settings.reasonChips) {
      setPassChips(settings.reasonChips.pass || []);
      setMaybeChips(settings.reasonChips.maybe || []);
    }
  }, [settings.reasonChips]);

  // Toast fires on every clean save. actionData?.savedAt is unique each time
  // (Date.now()), so the effect reliably re-fires even on back-to-back saves.
  useEffect(() => {
    if (actionData?.ok) {
      if (actionData?.testSent) {
        shopify.toast.show("Test event sent to Klaviyo");
      } else if (actionData?.klaviyoRemoved) {
        shopify.toast.show("Klaviyo key removed");
      } else if (actionData?.tagResult) {
        const r = actionData.tagResult;
        if (r.skipped) {
          shopify.toast.show("Set a buyer tag first");
        } else {
          shopify.toast.show(`Tagged ${r.updated}, ${r.guests} guests, ${r.failed} failed`);
        }
      } else {
        shopify.toast.show(actionData?.syncWarning
          ? "Settings saved (storefront sync failed)"
          : "Settings saved"
        );
      }
    }
  }, [actionData?.savedAt, actionData?.ok, actionData?.syncWarning, actionData?.testSent, actionData?.klaviyoRemoved, actionData?.tagResult, shopify]);

  // Handle remove key button
  const handleRemoveKey = () => {
    fetcher.submit({ intent: "removeKlaviyoKey" }, { method: "post" });
  };

  // Handle test event button
  const handleTestEvent = () => {
    fetcher.submit(
      { intent: "testKlaviyo", testEmail },
      { method: "post" }
    );
  };

  const isKlaviyoConnected = !!settings.klaviyoKeyLast4;
  const fetcherErrors = fetcher.data?.errors ?? {};

  // Chip editing helpers
  const moveChip = (list, setList, index, direction) => {
    const newList = [...list];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= newList.length) return;
    [newList[index], newList[newIndex]] = [newList[newIndex], newList[index]];
    setList(newList);
  };

  const updateChipLabel = (list, setList, index, label) => {
    const newList = [...list];
    newList[index] = { ...newList[index], label };
    setList(newList);
  };

  const retireChip = (list, setList, index) => {
    const newList = [...list];
    newList[index] = { ...newList[index], active: false };
    setList(newList);
  };

  const restoreChip = (list, setList, index) => {
    const newList = [...list];
    // Check max 8 active
    const activeCount = newList.filter(c => c.active).length;
    if (activeCount >= 8) {
      shopify.toast.show("Maximum 8 active chips per list");
      return;
    }
    newList[index] = { ...newList[index], active: true };
    setList(newList);
  };

  const addChip = (list, setList, label, setLabel) => {
    const trimmed = label.trim();
    if (trimmed.length < 2 || trimmed.length > 24) {
      shopify.toast.show("Label must be 2-24 characters");
      return;
    }
    if (!/^[a-zA-Z0-9 &'-]+$/.test(trimmed)) {
      shopify.toast.show("Only letters, numbers, spaces, &, -, ' allowed");
      return;
    }
    const activeCount = list.filter(c => c.active).length;
    if (activeCount >= 8) {
      shopify.toast.show("Maximum 8 active chips per list");
      return;
    }
    // Code will be generated server-side; use a placeholder
    setList([...list, { code: "", label: trimmed, active: true }]);
    setLabel("");
  };

  // Build chips JSON for form submission
  const reasonChipsJson = JSON.stringify({ pass: passChips, maybe: maybeChips });

  // Split chips into active and retired
  const activePassChips = passChips.filter(c => c.active);
  const retiredPassChips = passChips.map((c, i) => ({ ...c, originalIndex: i })).filter(c => !c.active);
  const activeMaybeChips = maybeChips.filter(c => c.active);
  const retiredMaybeChips = maybeChips.map((c, i) => ({ ...c, originalIndex: i })).filter(c => !c.active);

  return (
    <Form method="post" data-save-bar>
      <s-page heading="Settings">

        {/* Missing encryption key banner */}
        {!settings.hasEncryptionKey && (
          <s-banner tone="critical" heading="App not fully set up">
            The app isn&apos;t fully set up yet. Contact the developer.
          </s-banner>
        )}

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

        {/* ── b) Boards ─────────────────────────────────────────────────── */}
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
          <s-switch
            label="Ask partner why on Maybe and Pass votes"
            name="askReasons"
            checked={settings.askReasons || undefined}
          />
          <s-text-field
            label="Exclude tag"
            name="excludeTag"
            value={settings.excludeTag}
            details="Products with this tag can't be added to boards. Gift cards are always excluded."
            error={errors.excludeTag}
          />
          <s-text-field
            label="Board buyer tag"
            name="buyerTag"
            value={settings.buyerTag}
            details="Customers who order from a shared board get this tag, so you can build a customer segment in Shopify. Leave empty to turn off."
            error={errors.buyerTag}
          />
          <s-button
            variant="plain"
            onClick={() => {
              fetcher.submit({ intent: "tagPastBuyers" }, { method: "post" });
            }}
            disabled={fetcher.state !== "idle" || !settings.buyerTag || undefined}
          >
            Tag Past Board Buyers
          </s-button>
        </s-section>

        {/* ── c) Notifications ──────────────────────────────────────────── */}
        <s-section heading="Notifications">
          <s-switch
            label="Email the shopper when voting is done"
            name="notificationsEnabled"
            checked={settings.notificationsEnabled || undefined}
          />

          {/* Metric name for Klaviyo flow setup */}
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

          {/* Klaviyo connection status */}
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
              details="Create a private key in Klaviyo with Accounts: Read, Events: Full Access, and Profiles: Full Access scopes."
              disabled={!settings.hasEncryptionKey || undefined}
            />
          )}
        </s-section>

        {/* ── d) Reason Chips ───────────────────────────────────────────── */}
        <s-section heading="Reason Chips" id="reason-chips">
          <p style={{ marginBottom: "16px", color: "#6b7177" }}>
            Partners can pick one reason after Maybe or Not For Us.
            Add a chip when the same answer keeps showing up under Other.
          </p>

          {/* Hidden input for form submission */}
          <input type="hidden" name="reasonChips" value={reasonChipsJson} />

          {/* After Not For Us */}
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ marginBottom: "12px", fontWeight: 600 }}>After Not For Us</h3>
            {activePassChips.map((chip, i) => {
              const realIndex = passChips.findIndex(c => c === chip);
              return (
                <div key={chip.code || i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                  <s-text-field
                    value={chip.label}
                    onChange={(e) => updateChipLabel(passChips, setPassChips, realIndex, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <s-button
                    variant="plain"
                    onClick={() => moveChip(passChips, setPassChips, realIndex, -1)}
                    disabled={realIndex === 0 || undefined}
                  >↑</s-button>
                  <s-button
                    variant="plain"
                    onClick={() => moveChip(passChips, setPassChips, realIndex, 1)}
                    disabled={realIndex === passChips.length - 1 || undefined}
                  >↓</s-button>
                  <s-button
                    variant="plain"
                    tone="critical"
                    onClick={() => retireChip(passChips, setPassChips, realIndex)}
                  >Remove</s-button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <s-text-field
                placeholder="New chip label"
                value={newPassLabel}
                onChange={(e) => setNewPassLabel(e.target.value)}
                style={{ flex: 1 }}
              />
              <s-button
                onClick={() => addChip(passChips, setPassChips, newPassLabel, setNewPassLabel)}
                disabled={!newPassLabel.trim() || undefined}
              >Add</s-button>
            </div>
            {retiredPassChips.length > 0 && (
              <details style={{ marginTop: "12px" }}>
                <summary style={{ cursor: "pointer", color: "#6b7177" }}>
                  Retired chips ({retiredPassChips.length})
                </summary>
                <div style={{ marginTop: "8px" }}>
                  {retiredPassChips.map((chip) => (
                    <div key={chip.code} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                      <span style={{ flex: 1, color: "#6b7177" }}>{chip.label}</span>
                      <s-button
                        variant="plain"
                        onClick={() => restoreChip(passChips, setPassChips, chip.originalIndex)}
                      >Restore</s-button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* After Maybe */}
          <div>
            <h3 style={{ marginBottom: "12px", fontWeight: 600 }}>After Maybe</h3>
            {activeMaybeChips.map((chip, i) => {
              const realIndex = maybeChips.findIndex(c => c === chip);
              return (
                <div key={chip.code || i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                  <s-text-field
                    value={chip.label}
                    onChange={(e) => updateChipLabel(maybeChips, setMaybeChips, realIndex, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <s-button
                    variant="plain"
                    onClick={() => moveChip(maybeChips, setMaybeChips, realIndex, -1)}
                    disabled={realIndex === 0 || undefined}
                  >↑</s-button>
                  <s-button
                    variant="plain"
                    onClick={() => moveChip(maybeChips, setMaybeChips, realIndex, 1)}
                    disabled={realIndex === maybeChips.length - 1 || undefined}
                  >↓</s-button>
                  <s-button
                    variant="plain"
                    tone="critical"
                    onClick={() => retireChip(maybeChips, setMaybeChips, realIndex)}
                  >Remove</s-button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <s-text-field
                placeholder="New chip label"
                value={newMaybeLabel}
                onChange={(e) => setNewMaybeLabel(e.target.value)}
                style={{ flex: 1 }}
              />
              <s-button
                onClick={() => addChip(maybeChips, setMaybeChips, newMaybeLabel, setNewMaybeLabel)}
                disabled={!newMaybeLabel.trim() || undefined}
              >Add</s-button>
            </div>
            {retiredMaybeChips.length > 0 && (
              <details style={{ marginTop: "12px" }}>
                <summary style={{ cursor: "pointer", color: "#6b7177" }}>
                  Retired chips ({retiredMaybeChips.length})
                </summary>
                <div style={{ marginTop: "8px" }}>
                  {retiredMaybeChips.map((chip) => (
                    <div key={chip.code} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                      <span style={{ flex: 1, color: "#6b7177" }}>{chip.label}</span>
                      <s-button
                        variant="plain"
                        onClick={() => restoreChip(maybeChips, setMaybeChips, chip.originalIndex)}
                      >Restore</s-button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
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
