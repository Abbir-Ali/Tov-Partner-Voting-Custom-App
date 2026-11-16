import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import {
  getSettings,
  validateReasonChips,
  saveSettings,
  getSetupGuide,
  updateSetupGuideStep,
} from "../models/settings.server.js";
import { log } from "../utils/log.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return { reasonChips: settings.reasonChips };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const errors = {};

  // Parse reasonChips JSON
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
  let data = {};

  if (reasonChipsInput && !errors.reasonChips) {
    const chipResult = validateReasonChips(reasonChipsInput, currentSettings.reasonChips);
    Object.assign(errors, chipResult.errors);
    if (Object.keys(chipResult.errors).length === 0) {
      data.reasonChips = chipResult.data;
    }
  }

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  await saveSettings(session.shop, data);
  log.info("settings.reason_chips_saved", { shop: session.shop });

  // Mark setup guide step as complete
  const guide = await getSetupGuide(session.shop);
  if (!guide.steps.reasonChipsReviewed) {
    await updateSetupGuideStep(session.shop, "reasonChipsReviewed", true);
  }

  return Response.json({ ok: true, savedAt: Date.now() });
};

export default function ReasonChipsSettings() {
  const settings = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();
  const errors = actionData?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;

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

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [actionData?.savedAt, actionData?.ok, shopify]);

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
    const activeCount = newList.filter((c) => c.active).length;
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
    const activeCount = list.filter((c) => c.active).length;
    if (activeCount >= 8) {
      shopify.toast.show("Maximum 8 active chips per list");
      return;
    }
    setList([...list, { code: "", label: trimmed, active: true }]);
    setLabel("");
  };

  // Build chips JSON for form submission
  const reasonChipsJson = JSON.stringify({ pass: passChips, maybe: maybeChips });

  // Split chips into active and retired
  const activePassChips = passChips.filter((c) => c.active);
  const retiredPassChips = passChips
    .map((c, i) => ({ ...c, originalIndex: i }))
    .filter((c) => !c.active);
  const activeMaybeChips = maybeChips.filter((c) => c.active);
  const retiredMaybeChips = maybeChips
    .map((c, i) => ({ ...c, originalIndex: i }))
    .filter((c) => !c.active);

  return (
    <Form method="post" data-save-bar>
      <s-page
        heading="Reason Chips"
        back-action={JSON.stringify({ url: "/app/settings" })}
      >
        <style>{`
          .pvb-settings-layout { display: grid; grid-template-columns: 280px 1fr; gap: 40px; }
          @media (max-width: 800px) { .pvb-settings-layout { grid-template-columns: 1fr; gap: 16px; } }
          .pvb-settings-help h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #202223; }
          .pvb-settings-help p { font-size: 13px; color: #6d7175; line-height: 1.5; margin: 0; }
          .pvb-chip-list { margin-bottom: 24px; }
          .pvb-chip-list h4 { margin: 0 0 12px; font-weight: 600; font-size: 14px; }
          .pvb-chip-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
          .pvb-chip-add { display: flex; gap: 8px; margin-top: 12px; }
          .pvb-retired { margin-top: 12px; }
          .pvb-retired summary { cursor: pointer; color: #6d7175; font-size: 13px; }
          .pvb-retired-list { margin-top: 8px; }
          .pvb-retired-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
          .pvb-retired-label { flex: 1; color: #6d7175; }
        `}</style>

        {hasErrors && (
          <s-banner tone="critical" heading="Settings weren't saved">
            Fix the highlighted fields and save again.
          </s-banner>
        )}

        <s-section>
          <div className="pvb-settings-layout">
            <div className="pvb-settings-help">
              <h3>Reason Chips</h3>
              <p>
                Partners can pick one reason after Maybe or Not For Us. Add a
                chip when the same answer keeps showing up under Other. Partners
                always have an Other option to type their own.
              </p>
            </div>
            <div>
              {/* Hidden input for form submission */}
              <input type="hidden" name="reasonChips" value={reasonChipsJson} />

              {/* After Not For Us */}
              <div className="pvb-chip-list">
                <h4>After Not For Us</h4>
                {activePassChips.map((chip, i) => {
                  const realIndex = passChips.findIndex((c) => c === chip);
                  return (
                    <div key={chip.code || i} className="pvb-chip-row">
                      <s-text-field
                        value={chip.label}
                        onChange={(e) =>
                          updateChipLabel(passChips, setPassChips, realIndex, e.target.value)
                        }
                        style={{ flex: 1 }}
                      />
                      <s-button
                        variant="plain"
                        onClick={() => moveChip(passChips, setPassChips, realIndex, -1)}
                        disabled={realIndex === 0 || undefined}
                      >
                        ↑
                      </s-button>
                      <s-button
                        variant="plain"
                        onClick={() => moveChip(passChips, setPassChips, realIndex, 1)}
                        disabled={realIndex === passChips.length - 1 || undefined}
                      >
                        ↓
                      </s-button>
                      <s-button
                        variant="plain"
                        tone="critical"
                        onClick={() => retireChip(passChips, setPassChips, realIndex)}
                      >
                        Remove
                      </s-button>
                    </div>
                  );
                })}
                <div className="pvb-chip-add">
                  <s-text-field
                    placeholder="New chip label"
                    value={newPassLabel}
                    onChange={(e) => setNewPassLabel(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <s-button
                    onClick={() =>
                      addChip(passChips, setPassChips, newPassLabel, setNewPassLabel)
                    }
                    disabled={!newPassLabel.trim() || undefined}
                  >
                    Add
                  </s-button>
                </div>
                {retiredPassChips.length > 0 && (
                  <details className="pvb-retired">
                    <summary>Retired chips ({retiredPassChips.length})</summary>
                    <div className="pvb-retired-list">
                      {retiredPassChips.map((chip) => (
                        <div key={chip.code} className="pvb-retired-row">
                          <span className="pvb-retired-label">{chip.label}</span>
                          <s-button
                            variant="plain"
                            onClick={() =>
                              restoreChip(passChips, setPassChips, chip.originalIndex)
                            }
                          >
                            Restore
                          </s-button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* After Maybe */}
              <div className="pvb-chip-list">
                <h4>After Maybe</h4>
                {activeMaybeChips.map((chip, i) => {
                  const realIndex = maybeChips.findIndex((c) => c === chip);
                  return (
                    <div key={chip.code || i} className="pvb-chip-row">
                      <s-text-field
                        value={chip.label}
                        onChange={(e) =>
                          updateChipLabel(maybeChips, setMaybeChips, realIndex, e.target.value)
                        }
                        style={{ flex: 1 }}
                      />
                      <s-button
                        variant="plain"
                        onClick={() => moveChip(maybeChips, setMaybeChips, realIndex, -1)}
                        disabled={realIndex === 0 || undefined}
                      >
                        ↑
                      </s-button>
                      <s-button
                        variant="plain"
                        onClick={() => moveChip(maybeChips, setMaybeChips, realIndex, 1)}
                        disabled={realIndex === maybeChips.length - 1 || undefined}
                      >
                        ↓
                      </s-button>
                      <s-button
                        variant="plain"
                        tone="critical"
                        onClick={() => retireChip(maybeChips, setMaybeChips, realIndex)}
                      >
                        Remove
                      </s-button>
                    </div>
                  );
                })}
                <div className="pvb-chip-add">
                  <s-text-field
                    placeholder="New chip label"
                    value={newMaybeLabel}
                    onChange={(e) => setNewMaybeLabel(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <s-button
                    onClick={() =>
                      addChip(maybeChips, setMaybeChips, newMaybeLabel, setNewMaybeLabel)
                    }
                    disabled={!newMaybeLabel.trim() || undefined}
                  >
                    Add
                  </s-button>
                </div>
                {retiredMaybeChips.length > 0 && (
                  <details className="pvb-retired">
                    <summary>Retired chips ({retiredMaybeChips.length})</summary>
                    <div className="pvb-retired-list">
                      {retiredMaybeChips.map((chip) => (
                        <div key={chip.code} className="pvb-retired-row">
                          <span className="pvb-retired-label">{chip.label}</span>
                          <s-button
                            variant="plain"
                            onClick={() =>
                              restoreChip(maybeChips, setMaybeChips, chip.originalIndex)
                            }
                          >
                            Restore
                          </s-button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
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
