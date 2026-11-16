import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getBoardDetail,
  fetchCustomerNames,
  fetchVariantData,
} from "../services/audit.server.js";
import { getSettings } from "../models/settings.server.js";
import { DEFAULT_COPY } from "../models/settings.shared.js";
import { getReasonLabel } from "../models/reasons.shared.js";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const boardId = params.id;

  const [board, settings] = await Promise.all([
    getBoardDetail(shop, boardId),
    getSettings(shop),
  ]);

  // 404 for boards not found or from other shops
  if (!board) {
    throw new Response("Board not found", { status: 404 });
  }

  // Custom verdict labels from settings or defaults
  const verdictLabels = {
    LOVE: settings.copy?.loveLabel || DEFAULT_COPY.loveLabel,
    MAYBE: settings.copy?.maybeLabel || DEFAULT_COPY.maybeLabel,
    PASS: settings.copy?.passLabel || DEFAULT_COPY.passLabel,
  };

  // Collect IDs for live lookups
  const customerIds = new Set();
  const variantIds = new Set();

  if (board.shopperCustomerId) customerIds.add(board.shopperCustomerId);
  if (board.order?.customerId) customerIds.add(board.order.customerId);
  for (const item of board.items) {
    if (item.variantId) variantIds.add(item.variantId);
  }

  // Fetch names and variant data in parallel
  const [customerResult, variantResult] = await Promise.all([
    fetchCustomerNames(admin, Array.from(customerIds)),
    fetchVariantData(admin, Array.from(variantIds)),
  ]);

  // Attach shopper name
  board.shopperName = board.shopperCustomerId
    ? customerResult.map.get(board.shopperCustomerId) || "Customer"
    : board.shopperFirstName || "Guest";
  board.isGuest = !board.shopperCustomerId;

  // Attach order customer name
  if (board.order?.customerId) {
    board.order.customerName = customerResult.map.get(board.order.customerId) || "Customer";
  } else if (board.order) {
    board.order.customerName = "Guest checkout";
  }

  // Attach variant data to items
  for (const item of board.items) {
    const data = variantResult.map.get(item.variantId);
    item.productTitle = data?.productTitle || "Product";
    item.variantTitle = data?.variantTitle !== "Default Title" ? data?.variantTitle : null;
    item.imageUrl = data?.imageUrl || null;
  }

  // Get back URL from query string - validate it starts with "?" to prevent open redirect
  const url = new URL(request.url);
  const backParam = url.searchParams.get("back") || "";
  const backUrl = backParam.startsWith("?") ? `/app/boards${backParam}` : "/app/boards";

  return { board, verdictLabels, reasonChips: settings.reasonChips, backUrl };
};

// Format currency
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
    year: "numeric",
  });
}

// Format datetime for timeline
function formatDateTime(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Extract numeric ID from GID for admin links
function numericId(gid) {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

// Verdict badge colors
const VERDICT_STYLES = {
  LOVE: { background: "#485B59", color: "#FFFFFF" },
  MAYBE: { background: "#D9CFC5", color: "#3F3D3E" },
  PASS: { background: "#F9D2D2", color: "#3F3D3E" },
};

/* eslint-disable react/prop-types */
// Status badge component
function StatusBadge({ status, tone }) {
  const toneColors = {
    attention: { bg: "#FFF5E5", color: "#8A6116" },
    success: { bg: "#E3F5E1", color: "#1F6B2C" },
    info: { bg: "#E0F1FF", color: "#0B6CBF" },
    neutral: { bg: "#F1F1F1", color: "#6D7175" },
  };
  const style = toneColors[tone] || toneColors.neutral;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "4px",
        fontSize: "13px",
        fontWeight: 500,
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}
/* eslint-enable react/prop-types */

export default function BoardDetailPage() {
  const { board, verdictLabels, reasonChips, backUrl } = useLoaderData();

  const channelLabels = {
    whatsapp: "WhatsApp",
    sms: "SMS",
    email: "Email",
    copy: "Copy link",
    native: "Share sheet",
  };

  return (
    <s-page heading={`Board · ${formatDate(board.sharedAt)}`}>
      <s-link slot="breadcrumb-actions" href={backUrl}>
        Boards
      </s-link>

      <style>{`
        .pvb-detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .pvb-detail-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .pvb-detail-card h3 { font-size: 15px; font-weight: 600; margin: 0 0 16px; color: #202223; }
        .pvb-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
        .pvb-summary-item { }
        .pvb-summary-label { font-size: 12px; color: #6d7175; margin-bottom: 4px; }
        .pvb-summary-value { font-size: 14px; color: #202223; }
        .pvb-summary-value a { color: #485B59; text-decoration: none; }
        .pvb-summary-value a:hover { text-decoration: underline; }
        .pvb-guest { color: #6d7175; font-style: italic; }
        .pvb-pieces-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .pvb-pieces-counts { display: flex; gap: 16px; font-size: 13px; }
        .pvb-pieces-count { display: flex; align-items: center; gap: 4px; }
        .pvb-count-dot { width: 8px; height: 8px; border-radius: 2px; }
        .pvb-pieces-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .pvb-piece-card { border: 1px solid #e1e3e5; border-radius: 8px; padding: 12px; display: flex; gap: 12px; }
        .pvb-piece-image { width: 60px; height: 60px; border-radius: 4px; object-fit: cover; background: #f6f6f7; flex-shrink: 0; }
        .pvb-piece-info { flex: 1; min-width: 0; }
        .pvb-piece-title { font-size: 13px; font-weight: 500; color: #202223; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pvb-piece-variant { font-size: 12px; color: #6d7175; margin-bottom: 6px; }
        .pvb-piece-verdict { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
        .pvb-piece-reason { font-size: 11px; color: #6d7175; margin-top: 4px; font-style: italic; }
        .pvb-timeline { }
        .pvb-timeline-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f1f1f1; }
        .pvb-timeline-item:last-child { border-bottom: none; }
        .pvb-timeline-dot { width: 8px; height: 8px; border-radius: 50%; background: #485B59; margin-top: 5px; flex-shrink: 0; }
        .pvb-timeline-content { flex: 1; }
        .pvb-timeline-event { font-size: 14px; color: #202223; }
        .pvb-timeline-detail { font-size: 12px; color: #6d7175; }
        .pvb-timeline-time { font-size: 12px; color: #6d7175; white-space: nowrap; }
      `}</style>

      {/* Header with status */}
      <div className="pvb-detail-header">
        <StatusBadge status={board.status} tone={board.statusTone} />
      </div>

      {/* Summary card */}
      <div className="pvb-detail-card">
        <h3>Summary</h3>
        <div className="pvb-summary-grid">
          <div className="pvb-summary-item">
            <div className="pvb-summary-label">Shopper</div>
            <div className="pvb-summary-value">
              {board.shopperCustomerId ? (
                <a href={`shopify:admin/customers/${numericId(board.shopperCustomerId)}`}>
                  {board.shopperName}
                </a>
              ) : (
                <span className="pvb-guest">{board.shopperName} (guest)</span>
              )}
            </div>
          </div>
          <div className="pvb-summary-item">
            <div className="pvb-summary-label">Partner</div>
            <div className="pvb-summary-value">{board.partnerFirstName}</div>
          </div>
          <div className="pvb-summary-item">
            <div className="pvb-summary-label">Shared via</div>
            <div className="pvb-summary-value">
              {channelLabels[board.channel] || board.channel || "—"}
            </div>
          </div>
          <div className="pvb-summary-item">
            <div className="pvb-summary-label">Order</div>
            <div className="pvb-summary-value">
              {board.order ? (
                <a href={`shopify:admin/orders/${numericId(board.order.orderId)}`}>
                  {board.order.orderName}{board.order.valueCents > 0 ? ` (${formatCurrency(board.order.valueCents, board.order.currencyCode)})` : ""}
                </a>
              ) : (
                "—"
              )}
            </div>
          </div>
          {board.order && (
            <div className="pvb-summary-item">
              <div className="pvb-summary-label">Ordered by</div>
              <div className="pvb-summary-value">
                {board.order.customerId ? (
                  <a href={`shopify:admin/customers/${numericId(board.order.customerId)}`}>
                    {board.order.customerName}
                  </a>
                ) : (
                  "Guest checkout"
                )}
              </div>
            </div>
          )}
          <div className="pvb-summary-item">
            <div className="pvb-summary-label">Expires</div>
            <div className="pvb-summary-value">{formatDate(board.expiresAt)}</div>
          </div>
          {/* TODO: Prices hidden (later) */}
        </div>
      </div>

      {/* Pieces card */}
      <div className="pvb-detail-card">
        <div className="pvb-pieces-header">
          <h3 style={{ margin: 0 }}>Pieces ({board.pieceCount})</h3>
          <div className="pvb-pieces-counts">
            <span className="pvb-pieces-count">
              <span className="pvb-count-dot" style={{ background: "#485B59" }} />
              {board.loveCount} loved
            </span>
            <span className="pvb-pieces-count">
              <span className="pvb-count-dot" style={{ background: "#D9CFC5" }} />
              {board.maybeCount} maybe
            </span>
            <span className="pvb-pieces-count">
              <span className="pvb-count-dot" style={{ background: "#F9D2D2" }} />
              {board.passCount} no
            </span>
          </div>
        </div>
        <div className="pvb-pieces-grid">
          {board.items.map((item) => {
            const style = VERDICT_STYLES[item.verdict] || { background: "#f1f1f1", color: "#6d7175" };
            const reasonLabel = item.reason
              ? getReasonLabel(item.verdict, item.reason, reasonChips)
              : null;
            const reasonTextDisplay = item.reason === "other" && item.reasonText
              ? item.reasonText
              : null;

            return (
              <div key={item.id} className="pvb-piece-card">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="pvb-piece-image" />
                ) : (
                  <div className="pvb-piece-image" />
                )}
                <div className="pvb-piece-info">
                  <div className="pvb-piece-title" title={item.productTitle}>
                    {item.productTitle}
                  </div>
                  {item.variantTitle && (
                    <div className="pvb-piece-variant">{item.variantTitle}</div>
                  )}
                  {item.verdict ? (
                    <span
                      className="pvb-piece-verdict"
                      style={{ background: style.background, color: style.color }}
                    >
                      {verdictLabels[item.verdict]}
                    </span>
                  ) : (
                    <span className="pvb-piece-verdict" style={{ background: "#f1f1f1", color: "#6d7175" }}>
                      No vote
                    </span>
                  )}
                  {reasonLabel && (
                    <div className="pvb-piece-reason">
                      {reasonLabel}{reasonTextDisplay ? `: ${reasonTextDisplay}` : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Timeline card */}
      <div className="pvb-detail-card">
        <h3>Timeline</h3>
        <div className="pvb-timeline">
          {board.timeline.map((event, idx) => (
            <div key={idx} className="pvb-timeline-item">
              <span className="pvb-timeline-dot" />
              <div className="pvb-timeline-content">
                <div className="pvb-timeline-event">{event.event}</div>
                {event.detail && <div className="pvb-timeline-detail">{event.detail}</div>}
              </div>
              <div className="pvb-timeline-time">{formatDateTime(event.at)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <s-text tone="subdued" variant="bodySm">
        Names and images come from Shopify when this page loads.
      </s-text>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
