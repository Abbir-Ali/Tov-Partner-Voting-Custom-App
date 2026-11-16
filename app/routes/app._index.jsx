import { useState, useEffect } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  syncStorefrontConfig,
  needsSync,
} from "../services/storefront-config.server.js";
import {
  syncPixel,
  pixelNeedsSync,
} from "../services/pixel.server.js";
import {
  sendPendingNotifications,
  hasFailedNotifications,
  retryFailedNotifications,
} from "../services/notify.server.js";
import {
  getSettings,
  getSetupGuide,
  updateSetupGuideStep,
  dismissSetupGuide,
} from "../models/settings.server.js";
import {
  getDashboardData,
} from "../services/dashboard.server.js";
import { DEFAULT_COPY } from "../models/settings.shared.js";
import { DEFAULT_PASS_CHIPS, DEFAULT_MAYBE_CHIPS, getReasonLabel } from "../models/reasons.shared.js";
import prisma from "../db.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Self-heal: sync storefront config if needed
  let syncOk = true;
  if (await needsSync(shop)) {
    const result = await syncStorefrontConfig(admin, shop);
    syncOk = result.ok;
  }

  // Self-heal: sync Web Pixel if needed
  if (await pixelNeedsSync(shop)) {
    await syncPixel(admin, shop);
  }

  // Self-heal: retry pending notifications
  await sendPendingNotifications(shop);

  // Banner checks
  const settings = await getSettings(shop);
  const needsKlaviyoKey = settings.notificationsEnabled && !settings.klaviyoKeyEncrypted;
  const hasFailedNotifs = await hasFailedNotifications(shop);

  // Setup guide
  const setupGuide = await getSetupGuide(shop);

  // Auto-check setup guide steps
  // Step a: button_impression in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const hasButtonImpression = await prisma.analyticsEvent.findFirst({
    where: { shop, type: "button_impression", createdAt: { gte: sevenDaysAgo } },
    select: { id: true },
  });
  const themeButtonDone = !!hasButtonImpression;

  // Step b: Klaviyo connected
  const klaviyoConnectedDone = !!settings.klaviyoKeyEncrypted;

  // Step c: Reason chips reviewed (auto-check if chips differ from defaults)
  const reasonChipsReviewedDone = setupGuide.steps.reasonChipsReviewed || (() => {
    // Check if shop's chips differ from defaults
    const shopPass = settings.reasonChips?.pass || [];
    const shopMaybe = settings.reasonChips?.maybe || [];
    // Check length mismatch or any chip difference
    if (shopPass.length !== DEFAULT_PASS_CHIPS.length) return true;
    if (shopMaybe.length !== DEFAULT_MAYBE_CHIPS.length) return true;
    for (let i = 0; i < shopPass.length; i++) {
      const d = DEFAULT_PASS_CHIPS[i];
      const s = shopPass[i];
      if (s.code !== d.code || s.label !== d.label || s.active !== d.active) return true;
    }
    for (let i = 0; i < shopMaybe.length; i++) {
      const d = DEFAULT_MAYBE_CHIPS[i];
      const s = shopMaybe[i];
      if (s.code !== d.code || s.label !== d.label || s.active !== d.active) return true;
    }
    return false;
  })();

  // Step d: Copy customized (differs from defaults)
  const copyCustomizedDone = Object.keys(DEFAULT_COPY).some(
    (k) => settings.copy[k] && settings.copy[k] !== DEFAULT_COPY[k]
  );

  // Dashboard data (30 days for KPIs)
  const dashboard = await getDashboardData(shop, 30);

  // Latest boards (5 for the home page)
  const latestBoards = await prisma.board.findMany({
    where: { shop, status: { in: ["SHARED", "VOTED"] } },
    orderBy: { sharedAt: "desc" },
    take: 5,
    select: {
      id: true,
      partnerFirstName: true,
      sharedAt: true,
      status: true,
      votingCompletedAt: true,
      expiresAt: true,
      _count: { select: { items: true } },
    },
  });

  // Needs attention items
  const needsAttention = [];

  // 1. Failed notifications
  if (hasFailedNotifs) {
    needsAttention.push({
      type: "failed_emails",
      title: "Some voting-done emails failed",
      action: { label: "Retry", intent: "retryFailed" },
    });
  }

  // 2. Boards expiring soon without votes (within 3 days)
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const expiringBoards = await prisma.board.count({
    where: {
      shop,
      status: "SHARED",
      votingCompletedAt: null,
      expiresAt: { lte: threeDaysFromNow, gte: new Date() },
    },
  });
  if (expiringBoards > 0) {
    needsAttention.push({
      type: "expiring_boards",
      title: `${expiringBoards} board${expiringBoards > 1 ? "s" : ""} expiring soon without votes`,
      action: { label: "View Boards", href: "/app/boards" },
    });
  }

  // 3. Products with high pass rate due to Price (5+ pass votes with "price" reason)
  // Simplified: check if we have price-related pass reasons
  const pricePassCount = await prisma.vote.count({
    where: {
      boardItem: { board: { shop } },
      verdict: "PASS",
      reason: "price",
    },
  });
  if (pricePassCount >= 5) {
    // Get the real label from shop's chips (handles retired/renamed)
    const priceLabel = getReasonLabel("PASS", "price", settings.reasonChips);
    needsAttention.push({
      type: "price_feedback",
      title: `${pricePassCount} partners passed on ${priceLabel}`,
      action: { label: "See Products", href: "/app/analytics" },
    });
  }

  return {
    syncOk,
    needsKlaviyoKey,
    hasFailedNotifs,
    setupGuide: {
      ...setupGuide,
      steps: {
        ...setupGuide.steps,
        themeButton: themeButtonDone,
        klaviyoConnected: klaviyoConnectedDone,
        reasonChipsReviewed: reasonChipsReviewedDone,
        copyCustomized: copyCustomizedDone,
      },
    },
    dashboard,
    latestBoards,
    needsAttention: needsAttention.slice(0, 3), // Max 3 items
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "retryFailed") {
    const result = await retryFailedNotifications(session.shop);
    return Response.json({ ok: true, retryResult: result });
  }

  if (intent === "dismissGuide") {
    await dismissSetupGuide(session.shop);
    return Response.json({ ok: true, dismissed: true });
  }

  if (intent === "markSidekickDone") {
    await updateSetupGuideStep(session.shop, "sidekickEnabled", true);
    return Response.json({ ok: true, stepUpdated: true });
  }

  return Response.json({ ok: false }, { status: 400 });
};

// Format currency from cents
function formatCurrency(cents, currencyCode = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// Format date for display
function formatDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function Index() {
  const {
    syncOk,
    needsKlaviyoKey,
    hasFailedNotifs,
    setupGuide,
    dashboard,
    latestBoards,
    needsAttention,
  } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  // Check if Sidekick is available
  const [sidekickEnabled, setSidekickEnabled] = useState(false);
  useEffect(() => {
    shopify.sidekick?.isEnabled().then(setSidekickEnabled).catch(() => {});
  }, [shopify]);

  const handleAskSidekick = async () => {
    try {
      await shopify.sidekick.launch({
        message: "Give me a quick summary of my partner board results.",
      });
    } catch (err) {
      if (err?.message?.startsWith("sidekick.launch:")) {
        shopify.toast.show("Sidekick is unavailable right now");
      }
    }
  };

  const handleRetryFailed = () => {
    fetcher.submit({ intent: "retryFailed" }, { method: "post" });
  };

  const handleDismissGuide = () => {
    fetcher.submit({ intent: "dismissGuide" }, { method: "post" });
  };

  const handleMarkSidekickDone = () => {
    fetcher.submit({ intent: "markSidekickDone" }, { method: "post" });
  };

  // Show toast when retry completes
  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data?.retryResult) {
      const { reset, sent } = fetcher.data.retryResult;
      shopify.toast.show(`Retried ${reset}, sent ${sent}`);
    }
    if (fetcher.data?.ok && fetcher.data?.dismissed) {
      shopify.toast.show("Setup guide dismissed");
    }
    if (fetcher.data?.ok && fetcher.data?.stepUpdated) {
      shopify.toast.show("Step marked as done");
    }
  }, [fetcher.data, shopify]);

  // Setup guide steps
  const steps = [
    {
      key: "themeButton",
      title: "Turn on the Save button in your theme",
      done: setupGuide.steps.themeButton,
      action: {
        label: "Open Theme Editor",
        href: "shopify:admin/themes/current/editor?context=apps",
      },
    },
    {
      key: "klaviyoConnected",
      title: "Connect Klaviyo",
      done: setupGuide.steps.klaviyoConnected,
      action: { label: "Settings", href: "/app/settings/notifications" },
    },
    {
      key: "reasonChipsReviewed",
      title: "Review your reason chips",
      done: setupGuide.steps.reasonChipsReviewed,
      action: { label: "Settings", href: "/app/settings/reason-chips" },
    },
    {
      key: "copyCustomized",
      title: "Customize the vote page copy",
      done: setupGuide.steps.copyCustomized,
      action: { label: "Settings", href: "/app/settings/vote-page" },
    },
    {
      key: "sidekickEnabled",
      title: "Allow Sidekick to use the app",
      done: setupGuide.steps.sidekickEnabled,
      action: { label: "Mark as Done", onClick: handleMarkSidekickDone },
      helpText:
        'In the Dev Console, find pvb-sidekick and click admin.app.tools.data. For live, choose "Yes, and don\'t ask again" when Sidekick asks for access.',
    },
  ];

  const allStepsDone = steps.every((s) => s.done);
  const showSetupGuide = !setupGuide.dismissed && !allStepsDone;
  const completedCount = steps.filter((s) => s.done).length;

  // Build primary action for s-page
  const primaryAction = JSON.stringify({ content: "View Analytics", url: "/app/analytics" });

  return (
    <s-page
      heading="Partner Voting Board"
      primary-action={primaryAction}
    >
      {/* Secondary actions in title bar */}
      {sidekickEnabled && (
        <s-button slot="secondary-actions" onClick={handleAskSidekick}>
          Ask Sidekick
        </s-button>
      )}
      <style>{`
        .pvb-banner-actions { margin-top: 8px; }
        .pvb-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 16px 0; }
        .pvb-kpi-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 16px; }
        .pvb-kpi-value { font-size: 28px; font-weight: 600; color: #202223; }
        .pvb-kpi-label { font-size: 13px; color: #6d7175; margin-top: 4px; }
        .pvb-kpi-sub { font-size: 12px; color: #8c9196; margin-top: 2px; }
        .pvb-setup-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .pvb-setup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .pvb-setup-title { font-size: 15px; font-weight: 600; color: #202223; }
        .pvb-setup-progress { font-size: 13px; color: #6d7175; }
        .pvb-setup-steps { display: flex; flex-direction: column; gap: 8px; }
        .pvb-setup-step { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
        .pvb-setup-check { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #e1e3e5; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
        .pvb-setup-check[data-done="true"] { background: #485B59; border-color: #485B59; color: #fff; }
        .pvb-setup-text { flex: 1; }
        .pvb-setup-text-title { font-size: 14px; color: #202223; }
        .pvb-setup-text-title[data-done="true"] { color: #6d7175; text-decoration: line-through; }
        .pvb-setup-text-help { font-size: 12px; color: #8c9196; margin-top: 2px; }
        .pvb-setup-action { flex-shrink: 0; }
        .pvb-setup-dismiss { margin-top: 12px; text-align: right; }
        .pvb-attention-card { background: #fff8e5; border: 1px solid #ffc96b; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .pvb-attention-title { font-size: 14px; font-weight: 600; color: #573b00; margin-bottom: 12px; }
        .pvb-attention-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #ffeab3; }
        .pvb-attention-item:last-child { border-bottom: none; }
        .pvb-attention-text { font-size: 13px; color: #573b00; }
        .pvb-attention-empty { font-size: 13px; color: #6d7175; font-style: italic; }
        .pvb-boards-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pvb-boards-table th { text-align: left; padding: 8px; border-bottom: 1px solid #e1e3e5; color: #6d7175; font-weight: 500; }
        .pvb-boards-table td { padding: 8px; border-bottom: 1px solid #e1e3e5; color: #202223; }
        .pvb-status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
        .pvb-status-voted { background: #d4edda; color: #0d5435; }
        .pvb-status-shared { background: #e4e5e7; color: #6d7175; }
        .pvb-status-expired { background: #fed3a8; color: #573b00; }
        .pvb-view-all { display: block; text-align: center; padding: 12px; font-size: 13px; color: #485B59; text-decoration: none; }
        .pvb-view-all:hover { text-decoration: underline; }
        .pvb-empty { color: #6d7175; font-size: 13px; font-style: italic; padding: 24px 0; text-align: center; }
      `}</style>

      {/* Self-heal banners */}
      {!syncOk && (
        <s-banner tone="warning" heading="Storefront settings didn't sync">
          <Link to="/app/settings/general">Save Settings</Link> to try again.
        </s-banner>
      )}
      {needsKlaviyoKey && (
        <s-banner tone="info" heading="Connect Klaviyo">
          <Link to="/app/settings/notifications">Add your Klaviyo key</Link> so
          shoppers get an email when voting is done.
        </s-banner>
      )}
      {hasFailedNotifs && (
        <s-banner tone="warning" heading="Some emails couldn't be sent">
          <div className="pvb-banner-actions">
            <Link to="/app/settings/notifications">Check Klaviyo key</Link>
            {" · "}
            <s-button
              variant="plain"
              onClick={handleRetryFailed}
              disabled={fetcher.state !== "idle" || undefined}
            >
              Retry Failed Now
            </s-button>
          </div>
        </s-banner>
      )}

      {/* Setup guide */}
      {showSetupGuide && (
        <div className="pvb-setup-card">
          <div className="pvb-setup-header">
            <span className="pvb-setup-title">Get started</span>
            <span className="pvb-setup-progress">
              {completedCount} of {steps.length} done
            </span>
          </div>
          <div className="pvb-setup-steps">
            {steps.map((step) => (
              <div key={step.key} className="pvb-setup-step">
                <span className="pvb-setup-check" data-done={step.done}>
                  {step.done ? "✓" : ""}
                </span>
                <div className="pvb-setup-text">
                  <div className="pvb-setup-text-title" data-done={step.done}>
                    {step.title}
                  </div>
                  {step.helpText && !step.done && (
                    <div className="pvb-setup-text-help">{step.helpText}</div>
                  )}
                </div>
                {!step.done && (
                  <div className="pvb-setup-action">
                    {step.action.href ? (
                      step.action.href.startsWith("shopify:") ? (
                        <a
                          href={step.action.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <s-button variant="plain">{step.action.label}</s-button>
                        </a>
                      ) : (
                        <Link to={step.action.href}>
                          <s-button variant="plain">{step.action.label}</s-button>
                        </Link>
                      )
                    ) : (
                      <s-button variant="plain" onClick={step.action.onClick}>
                        {step.action.label}
                      </s-button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pvb-setup-dismiss">
            <s-button variant="plain" onClick={handleDismissGuide}>
              Dismiss
            </s-button>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <s-section heading="Last 30 days">
        <div className="pvb-kpi-grid">
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">
              {formatCurrency(dashboard.revenue.valueCents, dashboard.revenue.currencyCode)}
            </div>
            <div className="pvb-kpi-label">Revenue from boards</div>
          </div>
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">{dashboard.boardsShared}</div>
            <div className="pvb-kpi-label">Boards shared</div>
          </div>
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">
              {dashboard.voteRate.total > 0
                ? `${Math.round((dashboard.voteRate.voted / dashboard.voteRate.total) * 100)}%`
                : "—"}
            </div>
            <div className="pvb-kpi-label">Partner vote rate</div>
            <div className="pvb-kpi-sub">
              {dashboard.voteRate.voted} of {dashboard.voteRate.total} voted
            </div>
          </div>
        </div>
      </s-section>

      {/* Needs attention */}
      <s-section heading="Needs attention">
        {needsAttention.length > 0 ? (
          <div className="pvb-attention-card">
            {needsAttention.map((item, idx) => (
              <div key={idx} className="pvb-attention-item">
                <span className="pvb-attention-text">{item.title}</span>
                {item.action.href ? (
                  <Link to={item.action.href}>
                    <s-button variant="plain">{item.action.label}</s-button>
                  </Link>
                ) : (
                  <s-button
                    variant="plain"
                    onClick={() => fetcher.submit({ intent: item.action.intent }, { method: "post" })}
                    disabled={fetcher.state !== "idle" || undefined}
                  >
                    {item.action.label}
                  </s-button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="pvb-attention-empty">All good. Nothing needs your attention.</p>
        )}
      </s-section>

      {/* Latest boards */}
      <s-section heading="Latest boards">
        {latestBoards.length > 0 ? (
          <>
            <table className="pvb-boards-table">
              <thead>
                <tr>
                  <th>Shared</th>
                  <th>Partner</th>
                  <th>Pieces</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {latestBoards.map((board) => {
                  let status = "Waiting for votes";
                  let statusClass = "pvb-status-shared";
                  if (board.expiresAt && new Date(board.expiresAt) < new Date()) {
                    status = "Expired";
                    statusClass = "pvb-status-expired";
                  } else if (board.votingCompletedAt) {
                    status = "Voted";
                    statusClass = "pvb-status-voted";
                  }
                  return (
                    <tr key={board.id}>
                      <td>{formatDate(board.sharedAt)}</td>
                      <td>{board.partnerFirstName}</td>
                      <td>{board._count.items}</td>
                      <td>
                        <span className={`pvb-status-badge ${statusClass}`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Link to="/app/boards" className="pvb-view-all">
              View all boards →
            </Link>
          </>
        ) : (
          <p className="pvb-empty">No boards shared yet.</p>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
