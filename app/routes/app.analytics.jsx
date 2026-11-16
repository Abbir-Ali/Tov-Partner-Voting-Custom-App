import { useState, useEffect } from "react";
import { Link, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server.js";
import {
  getDashboardData,
  parseRange,
  fetchProductTitles,
} from "../services/dashboard.server.js";
import { getReasonLabel } from "../models/reasons.shared.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const days = parseRange(url.searchParams.get("days"));

  const [dashboard, settings] = await Promise.all([
    getDashboardData(shop, days),
    getSettings(shop),
  ]);

  // Fetch product titles for top products and feedback
  const productIds = [
    ...dashboard.topProducts.map((p) => p.productId),
    ...dashboard.productFeedback.map((p) => p.productId),
  ];
  const uniqueIds = [...new Set(productIds)];
  const { map: titleMap, ok: titlesOk } = await fetchProductTitles(admin, uniqueIds);

  for (const p of dashboard.topProducts) {
    const title = titleMap.get(p.productId);
    p.title = title || (titlesOk ? "Removed product" : "Product");
  }
  for (const p of dashboard.productFeedback) {
    const title = titleMap.get(p.productId);
    p.title = title || (titlesOk ? "Removed product" : "Product");
  }

  return {
    dashboard,
    reasonChips: settings.reasonChips,
  };
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
function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Calculate percentage change
function calcChange(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/* eslint-disable react/prop-types */
// Revenue chart SVG component
function RevenueChart({ data, days }) {
  if (!data.length) return null;

  const maxCents = Math.max(...data.map((d) => d.cents));
  if (maxCents === 0) return null;

  const width = 400;
  const height = 100;
  const padding = 20;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - 2 * padding);
    const y = height - padding - (d.cents / maxCents) * (height - 2 * padding);
    return { x, y, date: d.date };
  });

  const linePath = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");
  const fillPath =
    linePath +
    ` L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

  const minGap = (width - 2 * padding) * 0.15;
  const candidateIndices = [0];
  if (data.length > 2) {
    const steps = Math.min(3, data.length - 2);
    for (let s = 1; s <= steps; s++) {
      candidateIndices.push(Math.round((s / (steps + 1)) * (data.length - 1)));
    }
  }
  candidateIndices.push(data.length - 1);

  const labelIndices = [];
  let lastX = -Infinity;
  for (const idx of [...new Set(candidateIndices)]) {
    const x = points[idx].x;
    if (x - lastX >= minGap || labelIndices.length === 0) {
      labelIndices.push(idx);
      lastX = x;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height + 20}`}
      style={{ width: "100%", height: "auto" }}
      aria-label={`Revenue chart for ${days} days`}
    >
      <path d={fillPath} fill="#485B59" fillOpacity="0.1" />
      <path d={linePath} fill="none" stroke="#485B59" strokeWidth="2" />
      {labelIndices.map((idx) => (
        <text
          key={idx}
          x={points[idx].x}
          y={height + 12}
          textAnchor="middle"
          fontSize="10"
          fill="#82736C"
        >
          {formatDate(data[idx].date)}
        </text>
      ))}
    </svg>
  );
}

// Funnel bar component
function FunnelBar({ label, count, percent }) {
  return (
    <div className="pvb-funnel-row">
      <span className="pvb-funnel-label">{label}</span>
      <span className="pvb-funnel-count">{count.toLocaleString()}</span>
      <div className="pvb-funnel-bar-bg">
        <div className="pvb-funnel-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Stacked bar for product feedback
function FeedbackBar({ love, maybe, pass, total }) {
  const loveWidth = (love / total) * 100;
  const maybeWidth = (maybe / total) * 100;
  const passWidth = (pass / total) * 100;

  return (
    <div className="pvb-feedback-bar">
      <div style={{ width: `${loveWidth}%`, background: "#485B59" }} />
      <div style={{ width: `${maybeWidth}%`, background: "#D9CFC5" }} />
      <div style={{ width: `${passWidth}%`, background: "#F9D2D2" }} />
    </div>
  );
}
/* eslint-enable react/prop-types */

export default function AnalyticsPage() {
  const { dashboard, reasonChips } = useLoaderData();
  const shopify = useAppBridge();

  const currentDays = dashboard.range;

  // Check if Sidekick is available
  const [sidekickEnabled, setSidekickEnabled] = useState(false);
  useEffect(() => {
    shopify.sidekick?.isEnabled().then(setSidekickEnabled).catch(() => {});
  }, [shopify]);

  const handleAskSidekick = async () => {
    try {
      await shopify.sidekick.launch({
        message: `Summarize my partner board results for the last ${currentDays} days and point out products with low partner approval.`,
      });
    } catch (err) {
      if (err?.message?.startsWith("sidekick.launch:")) {
        shopify.toast.show("Sidekick is unavailable right now");
      }
    }
  };

  // Revenue change
  const revenueChange = calcChange(
    dashboard.revenue.valueCents,
    dashboard.revenue.previousValueCents
  );

  // Funnel
  const funnelSteps = [
    { label: "Button seen", count: dashboard.funnel.buttonSeen },
    { label: "Saved to board", count: dashboard.funnel.saved },
    { label: "Shared", count: dashboard.funnel.shared },
    { label: "Partner opened", count: dashboard.funnel.partnerOpened },
    { label: "Voting done", count: dashboard.funnel.votingDone },
    { label: "Added to cart", count: dashboard.funnel.addedToCart },
    { label: "Ordered", count: dashboard.funnel.ordered },
  ];
  const funnelMax = Math.max(...funnelSteps.map((s) => s.count), 1);

  const { since } = { since: new Date(Date.now() - currentDays * 24 * 60 * 60 * 1000) };
  const showTrackingNote = dashboard.firstEventDate && new Date(dashboard.firstEventDate) >= since;

  // Handle page action events (for Sidekick button click)
  const handleSidekickClick = () => {
    handleAskSidekick();
  };

  return (
    <s-page heading="Analytics">
      {/* Secondary actions in title bar */}
      {sidekickEnabled && (
        <s-button slot="secondary-actions" onClick={handleSidekickClick}>
          Ask Sidekick
        </s-button>
      )}
      <style>{`
        .pvb-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 16px 0; }
        .pvb-kpi-card { background: #FEFBF6; border: 1px solid #F1ECE5; border-radius: 8px; padding: 16px; }
        .pvb-kpi-value { font-size: 28px; font-weight: 600; color: #3F3D3E; }
        .pvb-kpi-label { font-size: 13px; color: #82736C; margin-top: 4px; }
        .pvb-kpi-sub { font-size: 12px; color: #82736C; margin-top: 2px; }
        .pvb-change { font-size: 13px; margin-left: 8px; }
        .pvb-change-up { color: #485B59; }
        .pvb-change-down { color: #A40713; }
        .pvb-funnel-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
        .pvb-funnel-label { width: 120px; font-size: 13px; color: #3F3D3E; }
        .pvb-funnel-count { width: 60px; text-align: right; font-size: 13px; color: #82736C; }
        .pvb-funnel-bar-bg { flex: 1; height: 16px; background: #F1ECE5; border-radius: 4px; overflow: hidden; }
        .pvb-funnel-bar { height: 100%; background: #485B59; }
        .pvb-orders-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pvb-orders-table th { text-align: left; padding: 8px; border-bottom: 1px solid #F1ECE5; color: #82736C; font-weight: 500; }
        .pvb-orders-table td { padding: 8px; border-bottom: 1px solid #F1ECE5; color: #3F3D3E; }
        .pvb-orders-table a { color: #485B59; text-decoration: none; }
        .pvb-orders-table a:hover { text-decoration: underline; }
        .pvb-insights-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
        .pvb-insights-full { margin: 16px 0; }
        @media (max-width: 700px) { .pvb-insights-row { grid-template-columns: 1fr; } }
        .pvb-insight-card { background: #FEFBF6; border: 1px solid #F1ECE5; border-radius: 8px; padding: 16px; }
        .pvb-insight-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .pvb-insight-title { font-size: 14px; font-weight: 600; color: #3F3D3E; }
        .pvb-insight-legend { display: flex; gap: 12px; font-size: 11px; color: #82736C; }
        .pvb-legend-item { display: flex; align-items: center; gap: 4px; }
        .pvb-legend-dot { width: 8px; height: 8px; border-radius: 2px; }
        .pvb-product-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F1ECE5; font-size: 13px; }
        .pvb-product-row:last-child { border-bottom: none; }
        .pvb-product-title { color: #3F3D3E; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pvb-product-count { color: #82736C; }
        .pvb-feedback-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #F1ECE5; font-size: 13px; }
        .pvb-feedback-row:last-child { border-bottom: none; }
        .pvb-feedback-title { width: 260px; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3F3D3E; }
        .pvb-feedback-bar { display: flex; flex: 1; height: 12px; border-radius: 3px; overflow: hidden; }
        .pvb-feedback-pct { width: 70px; text-align: right; color: #82736C; white-space: nowrap; }
        .pvb-channel-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F1ECE5; font-size: 13px; }
        .pvb-channel-row:last-child { border-bottom: none; }
        .pvb-empty { color: #82736C; font-size: 13px; font-style: italic; }
        .pvb-settings-link { display: block; margin-top: 12px; font-size: 12px; color: #82736C; text-decoration: none; }
        .pvb-settings-link:hover { text-decoration: underline; }
        .pvb-note { font-size: 12px; color: #82736C; margin-top: 8px; line-height: 1.4; }
        .pvb-section-help { font-size: 12px; color: #82736C; margin-bottom: 12px; }
      `}</style>

      {/* Range selector */}
      <s-button-group variant="segmented" style={{ marginBottom: "16px" }}>
        {[7, 14, 30, 60].map((d) => (
          <s-button
            key={d}
            variant={currentDays === d ? "primary" : undefined}
            onClick={() => window.location.href = `?days=${d}`}
          >
            {d} days
          </s-button>
        ))}
      </s-button-group>

      {/* Revenue and funnel */}
      <s-section heading="Revenue and Funnel">
        <p className="pvb-section-help">
          Revenue from orders placed through the results page. Only counts when
          the cart was filled from a board.
        </p>
        <div className="pvb-kpi-card">
          <span className="pvb-kpi-value">
            {formatCurrency(dashboard.revenue.valueCents, dashboard.revenue.currencyCode)}
          </span>
          {revenueChange !== null && (
            <span className={`pvb-change ${revenueChange >= 0 ? "pvb-change-up" : "pvb-change-down"}`}>
              {revenueChange >= 0 ? "+" : ""}
              {revenueChange}% vs prior period
            </span>
          )}
          {dashboard.revenue.hasMultipleCurrencies && (
            <div className="pvb-kpi-sub">
              Showing {dashboard.revenue.currencyCode}; other currencies exist
            </div>
          )}
        </div>
        <RevenueChart data={dashboard.dailyRevenue} days={currentDays} />

        {/* KPI cards */}
        <div className="pvb-kpi-grid">
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">{dashboard.revenue.orderCount}</div>
            <div className="pvb-kpi-label">Orders from boards</div>
            <div className="pvb-kpi-sub">of {dashboard.boardsShared} boards shared</div>
          </div>
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">
              {dashboard.aov > 0 ? formatCurrency(dashboard.aov, dashboard.revenue.currencyCode) : "—"}
            </div>
            <div className="pvb-kpi-label">Average order value</div>
          </div>
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">
              {dashboard.voteRate.total > 0
                ? `${Math.round((dashboard.voteRate.voted / dashboard.voteRate.total) * 100)}%`
                : "—"}
            </div>
            <div className="pvb-kpi-label">Partner vote rate</div>
            <div className="pvb-kpi-sub">
              {dashboard.voteRate.voted} of {dashboard.voteRate.total} partners voted
            </div>
          </div>
          <div className="pvb-kpi-card">
            <div className="pvb-kpi-value">{dashboard.notifyStats.sent}</div>
            <div className="pvb-kpi-label">&quot;Voting done&quot; emails</div>
            <div className="pvb-kpi-sub">
              Pending: {dashboard.notifyStats.pending} · Failed: {dashboard.notifyStats.failed}
            </div>
          </div>
        </div>

        {/* Funnel */}
        {funnelMax > 0 ? (
          <>
            {funnelSteps.map((step) => (
              <FunnelBar
                key={step.label}
                label={step.label}
                count={step.count}
                percent={(step.count / funnelMax) * 100}
              />
            ))}
            {showTrackingNote && (
              <p className="pvb-note">
                Button seen and Saved to board are counted from tracking events, which
                started on {formatDate(dashboard.firstEventDate)}.
              </p>
            )}
          </>
        ) : (
          <p className="pvb-empty">No activity yet in this period.</p>
        )}
      </s-section>

      {/* Orders */}
      <s-section heading="Orders from Boards">
        <p className="pvb-section-help">
          Recent orders where the cart was filled from the board results page.
        </p>
        {dashboard.latestOrders.length > 0 ? (
          <table className="pvb-orders-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Pieces</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.latestOrders.map((order, idx) => (
                <tr key={idx}>
                  <td>
                    {order.numericOrderId ? (
                      <a
                        href={`shopify:admin/orders/${order.numericOrderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {order.orderName}
                      </a>
                    ) : (
                      order.orderName
                    )}
                  </td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>
                    {order.itemCount} piece{order.itemCount !== 1 ? "s" : ""} · loved{" "}
                    {order.lovedCount}
                  </td>
                  <td>{formatCurrency(order.valueCents, order.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pvb-empty">No orders from boards yet in this period.</p>
        )}
      </s-section>

      {/* Products */}
      <s-section heading="Products">
        <p className="pvb-section-help">
          Which products get shared most, and how partners react to them.
        </p>
        <div className="pvb-insights-row">
          {/* Top shared */}
          <div className="pvb-insight-card">
            <div className="pvb-insight-title">Top shared products</div>
            {dashboard.topProducts.length > 0 ? (
              dashboard.topProducts.map((p, idx) => (
                <div key={idx} className="pvb-product-row">
                  <span className="pvb-product-title" title={p.title}>
                    {p.title}
                  </span>
                  <span className="pvb-product-count">{p.count} boards</span>
                </div>
              ))
            ) : (
              <p className="pvb-empty">No shared boards yet.</p>
            )}
          </div>

          {/* Partner feedback */}
          <div className="pvb-insight-card">
            <div className="pvb-insight-header">
              <div className="pvb-insight-title">What partners think</div>
              <div className="pvb-insight-legend">
                <span className="pvb-legend-item">
                  <span className="pvb-legend-dot" style={{ background: "#485B59" }} />
                  Loved
                </span>
                <span className="pvb-legend-item">
                  <span className="pvb-legend-dot" style={{ background: "#D9CFC5" }} />
                  Maybe
                </span>
                <span className="pvb-legend-item">
                  <span className="pvb-legend-dot" style={{ background: "#F9D2D2" }} />
                  Not for us
                </span>
              </div>
            </div>
            {dashboard.productFeedback.length > 0 ? (
              dashboard.productFeedback.map((p, idx) => (
                <div key={idx} className="pvb-feedback-row">
                  <span className="pvb-feedback-title" title={p.title}>
                    {p.title}
                  </span>
                  <FeedbackBar
                    love={p.love}
                    maybe={p.maybe}
                    pass={p.pass}
                    total={p.total}
                  />
                  <span className="pvb-feedback-pct">{p.lovePercent}% loved</span>
                </div>
              ))
            ) : (
              <p className="pvb-empty">Need 5+ votes per product.</p>
            )}
          </div>
        </div>
      </s-section>

      {/* Partner reasons */}
      {dashboard.partnerReasons.total > 0 && (
        <s-section heading="Partner Reasons">
          <p className="pvb-section-help">
            Why partners chose Maybe or Not For Us. Use these insights to adjust
            your reason chips.
          </p>
          <div className="pvb-insights-row">
            <div className="pvb-insight-card">
              <div className="pvb-insight-title">Why partners pass</div>
              {dashboard.partnerReasons.pass.length > 0 ? (
                dashboard.partnerReasons.pass.map((r, idx) => (
                  <div key={idx} className="pvb-channel-row">
                    <span>{getReasonLabel("PASS", r.reason, reasonChips)}</span>
                    <span className="pvb-product-count">{r.count}</span>
                  </div>
                ))
              ) : (
                <p className="pvb-empty">No pass reasons yet.</p>
              )}
              <Link to="/app/settings/reason-chips" className="pvb-settings-link">
                Turn an answer into a chip
              </Link>
            </div>
            <div className="pvb-insight-card">
              <div className="pvb-insight-title">Why partners say maybe</div>
              {dashboard.partnerReasons.maybe.length > 0 ? (
                dashboard.partnerReasons.maybe.map((r, idx) => (
                  <div key={idx} className="pvb-channel-row">
                    <span>{getReasonLabel("MAYBE", r.reason, reasonChips)}</span>
                    <span className="pvb-product-count">{r.count}</span>
                  </div>
                ))
              ) : (
                <p className="pvb-empty">No maybe reasons yet.</p>
              )}
              <Link to="/app/settings/reason-chips" className="pvb-settings-link">
                Turn an answer into a chip
              </Link>
            </div>
          </div>
        </s-section>
      )}

      {/* Sharing */}
      <s-section heading="Sharing">
        <p className="pvb-section-help">
          How shoppers share their boards and which channels get the best
          response.
        </p>
        <div className="pvb-insights-row">
          <div className="pvb-insight-card">
            <div className="pvb-insight-title">Shares by channel</div>
            {dashboard.sharesByChannel.length > 0 ? (
              dashboard.sharesByChannel.map((ch, idx) => (
                <div key={idx} className="pvb-channel-row">
                  <span>{ch.label}</span>
                  <span className="pvb-product-count">{ch.count}</span>
                </div>
              ))
            ) : (
              <p className="pvb-empty">No shares yet.</p>
            )}
          </div>
          <div className="pvb-insight-card">
            <div className="pvb-insight-title">Vote rate by channel</div>
            {dashboard.voteRateByChannel.length > 0 ? (
              dashboard.voteRateByChannel.map((ch, idx) => (
                <div key={idx} className="pvb-channel-row">
                  <span>{ch.label}</span>
                  <span className="pvb-product-count">{ch.rate}%</span>
                </div>
              ))
            ) : (
              <p className="pvb-empty">Need 5+ boards per channel.</p>
            )}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
