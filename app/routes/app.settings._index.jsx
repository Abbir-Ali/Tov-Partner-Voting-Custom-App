import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";
import { getSettings } from "../models/settings.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  // Determine status indicators for each section
  const isKlaviyoConnected = !!settings.klaviyoKeyLast4;

  return {
    enabled: settings.enabled,
    notificationsEnabled: settings.notificationsEnabled,
    isKlaviyoConnected,
  };
};

// Settings section definitions
const SECTIONS = [
  {
    id: "general",
    title: "General",
    description: "Enable the feature, set board limits and expiry",
    href: "/app/settings/general",
  },
  {
    id: "vote-page",
    title: "Vote Page",
    description: "Labels, headlines, and messages your partner sees",
    href: "/app/settings/vote-page",
  },
  {
    id: "reason-chips",
    title: "Reason Chips",
    description: "Quick-pick reasons for Maybe and Not For Us votes",
    href: "/app/settings/reason-chips",
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Voting-done emails via Klaviyo",
    href: "/app/settings/notifications",
  },
  {
    id: "customers",
    title: "Customers and Tags",
    description: "Tag customers who order from a board",
    href: "/app/settings/customers",
  },
  {
    id: "privacy",
    title: "Privacy",
    description: "What the app stores and data retention",
    href: "/app/settings/privacy",
  },
];

export default function SettingsIndex() {
  const { enabled, isKlaviyoConnected, notificationsEnabled } = useLoaderData();

  // Status badges for sections
  const getStatus = (sectionId) => {
    if (sectionId === "general") {
      return enabled ? { label: "On", tone: "success" } : { label: "Off", tone: "warning" };
    }
    if (sectionId === "notifications") {
      if (!notificationsEnabled) return { label: "Off", tone: "subdued" };
      return isKlaviyoConnected
        ? { label: "Connected", tone: "success" }
        : { label: "Not connected", tone: "warning" };
    }
    return null;
  };

  return (
    <s-page heading="Settings">
      <style>{`
        .pvb-settings-list { display: flex; flex-direction: column; gap: 1px; background: #e1e3e5; border-radius: 8px; overflow: hidden; }
        .pvb-settings-item { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff; text-decoration: none; color: inherit; transition: background 0.1s; }
        .pvb-settings-item:hover { background: #f6f6f7; }
        .pvb-settings-content { flex: 1; }
        .pvb-settings-title { font-size: 14px; font-weight: 600; color: #202223; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
        .pvb-settings-desc { font-size: 13px; color: #6d7175; }
        .pvb-settings-chevron { color: #8c9196; font-size: 18px; }
        .pvb-status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.02em; }
        .pvb-status-success { background: #aee9d1; color: #0d5435; }
        .pvb-status-warning { background: #fed3a8; color: #573b00; }
        .pvb-status-subdued { background: #e4e5e7; color: #6d7175; }
      `}</style>

      <s-section>
        <div className="pvb-settings-list">
          {SECTIONS.map((section) => {
            const status = getStatus(section.id);
            return (
              <Link key={section.id} to={section.href} className="pvb-settings-item">
                <div className="pvb-settings-content">
                  <div className="pvb-settings-title">
                    {section.title}
                    {status && (
                      <span className={`pvb-status-badge pvb-status-${status.tone}`}>
                        {status.label}
                      </span>
                    )}
                  </div>
                  <div className="pvb-settings-desc">{section.description}</div>
                </div>
                <span className="pvb-settings-chevron">›</span>
              </Link>
            );
          })}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
