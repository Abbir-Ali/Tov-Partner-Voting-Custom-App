import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getAuditBoards,
  fetchCustomerNames,
  fetchVariantTitles,
} from "../services/audit.server.js";
import { getSettings } from "../models/settings.server.js";
import { DEFAULT_COPY } from "../models/settings.shared.js";
import { getReasonLabel } from "../models/reasons.shared.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const filter = url.searchParams.get("filter") || "all";

  const [{ boards, nextCursor }, settings] = await Promise.all([
    getAuditBoards(shop, { cursor, filter }),
    getSettings(shop),
  ]);

  // Custom verdict labels from settings or defaults
  const verdictLabels = {
    LOVE: settings.copy?.loveLabel || DEFAULT_COPY.loveLabel,
    MAYBE: settings.copy?.maybeLabel || DEFAULT_COPY.maybeLabel,
    PASS: settings.copy?.passLabel || DEFAULT_COPY.passLabel,
  };

  // Collect IDs for live lookups
  const customerIds = new Set();
  const variantIds = new Set();

  for (const b of boards) {
    if (b.shopperCustomerId) customerIds.add(b.shopperCustomerId);
    if (b.order?.customerId) customerIds.add(b.order.customerId);
    for (const item of b.items) {
      if (item.variantId) variantIds.add(item.variantId);
    }
  }

  // Fetch names in parallel
  const [customerResult, variantResult] = await Promise.all([
    fetchCustomerNames(admin, Array.from(customerIds)),
    fetchVariantTitles(admin, Array.from(variantIds)),
  ]);

  // Attach names
  for (const b of boards) {
    b.shopperName = b.shopperCustomerId
      ? customerResult.map.get(b.shopperCustomerId) || "Customer"
      : `${b.shopperFirstName} (guest)`;

    if (b.order?.customerId) {
      b.order.customerName = customerResult.map.get(b.order.customerId) || "Customer";
    } else if (b.order) {
      b.order.customerName = "Guest checkout";
    }

    for (const item of b.items) {
      const variantData = variantResult.map.get(item.variantId);
      item.productTitle = variantData?.productTitle || "Product";
      // Only show variant title if not "Default Title"
      item.variantTitle = variantData?.variantTitle !== "Default Title"
        ? variantData?.variantTitle
        : null;
    }
  }

  return { boards, nextCursor, filter, verdictLabels, reasonChips: settings.reasonChips };
};

// Filter options for the segmented control
const FILTERS = [
  { value: "all", label: "All" },
  { value: "orders", label: "With an Order" },
  { value: "repeat", label: "Repeat Buyers" },
];

// Extract numeric ID from GID for admin links
function numericId(gid) {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

// Format currency
function formatCurrency(cents, currencyCode = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// Format date
function formatDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Verdict badge colors: Forest for Loved, soft colors for others (no Bold Lip red)
const VERDICT_STYLES = {
  LOVE: { background: "#485B59", color: "#FFFFFF" },   // Forest, white text
  MAYBE: { background: "#D9CFC5", color: "#3F3D3E" },  // Soft taupe, Not-Black text
  PASS: { background: "#F9D2D2", color: "#3F3D3E" },   // Blush, Not-Black text
};

export default function BoardsPage() {
  const { boards, nextCursor, filter, verdictLabels, reasonChips } = useLoaderData();
  const [expandedId, setExpandedId] = useState(null);

  const handleNextPage = () => {
    if (!nextCursor) return;
    // Navigate with cursor while preserving filter
    window.location.href = `?filter=${filter}&cursor=${nextCursor}`;
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <s-page heading="Boards">
      <style>{`
        .pvb-filter-btns { display: flex; gap: 8px; margin-bottom: 16px; }
        .pvb-filter-btn { padding: 6px 12px; border: 1px solid #82736C; border-radius: 20px; background: #FEFBF6; color: #3F3D3E; text-decoration: none; font-size: 13px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
        .pvb-filter-btn[data-active="true"] { background: #485B59; color: #FEFBF6; border-color: #485B59; }
      `}</style>

      {/* Filter tabs - pill style matching dashboard range buttons */}
      <div className="pvb-filter-btns">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            to={`?filter=${f.value}`}
            className="pvb-filter-btn"
            data-active={filter === f.value}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {boards.length === 0 ? (
        <s-card>
          <s-text>No boards found.</s-text>
        </s-card>
      ) : (
        <s-card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                <th style={{ padding: "12px 8px" }}>Shared</th>
                <th style={{ padding: "12px 8px" }}>Shopper</th>
                <th style={{ padding: "12px 8px" }}>Partner</th>
                <th style={{ padding: "12px 8px" }}>Pieces</th>
                <th style={{ padding: "12px 8px" }}>Status</th>
                <th style={{ padding: "12px 8px" }}>Order</th>
                <th style={{ padding: "12px 8px" }}>Ordered by</th>
                <th style={{ padding: "12px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <>
                  <tr
                    key={b.id}
                    style={{ borderBottom: "1px solid #e1e3e5", cursor: "pointer" }}
                    onClick={() => toggleExpand(b.id)}
                  >
                    <td style={{ padding: "12px 8px" }}>{formatDate(b.sharedAt)}</td>
                    <td style={{ padding: "12px 8px" }}>
                      {b.shopperCustomerId ? (
                        <a
                          href={`shopify:admin/customers/${numericId(b.shopperCustomerId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.shopperName}
                        </a>
                      ) : (
                        b.shopperName
                      )}
                    </td>
                    <td style={{ padding: "12px 8px" }}>{b.partnerFirstName}</td>
                    <td style={{ padding: "12px 8px" }}>
                      {b.pieceCount} ({b.loveCount}/{b.maybeCount}/{b.passCount})
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          background:
                            b.status === "Voted"
                              ? "#d4edda"
                              : b.status === "Expired"
                                ? "#f8d7da"
                                : "#e2e3e5",
                        }}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {b.order ? (
                        <a
                          href={`shopify:admin/orders/${numericId(b.order.orderId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.order.orderName} ({formatCurrency(b.order.valueCents, b.order.currencyCode)})
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {b.order?.customerId ? (
                        <a
                          href={`shopify:admin/customers/${numericId(b.order.customerId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.order.customerName}
                        </a>
                      ) : b.order ? (
                        "Guest checkout"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <s-button variant="plain" size="slim">
                        {expandedId === b.id ? "Hide" : "View"}
                      </s-button>
                    </td>
                  </tr>
                  {expandedId === b.id && (
                    <tr key={`${b.id}-expanded`}>
                      <td colSpan={8} style={{ padding: "12px 8px 24px 24px", background: "#f9fafb" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                          {b.items.map((item) => {
                            const style = VERDICT_STYLES[item.verdict] || VERDICT_STYLES.MAYBE;
                            const reasonLabel = item.reason
                              ? getReasonLabel(item.verdict, item.reason, reasonChips)
                              : null;
                            // For "other" chip, show the reasonText after the label
                            const reasonTextDisplay = item.reason === "other" && item.reasonText
                              ? item.reasonText
                              : null;
                            return (
                              <div
                                key={item.id}
                                style={{
                                  padding: "8px 12px",
                                  border: "1px solid #e1e3e5",
                                  borderRadius: "8px",
                                  background: "#fff",
                                  minWidth: "150px",
                                }}
                              >
                                <div style={{ fontSize: "13px", fontWeight: 500 }}>{item.productTitle}</div>
                                {item.variantTitle && (
                                  <div style={{ fontSize: "12px", color: "#82736C" }}>{item.variantTitle}</div>
                                )}
                                {item.verdict && (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      marginTop: "4px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      color: style.color,
                                      background: style.background,
                                    }}
                                  >
                                    {verdictLabels[item.verdict]}
                                  </span>
                                )}
                                {reasonLabel && (
                                  <div style={{ fontSize: "11px", color: "#82736C", marginTop: "4px", fontStyle: "italic" }}>
                                    {reasonLabel}{reasonTextDisplay ? `: ${reasonTextDisplay}` : ""}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {nextCursor && (
            <div style={{ padding: "16px", textAlign: "center" }}>
              <s-button onClick={handleNextPage}>Load more</s-button>
            </div>
          )}
        </s-card>
      )}

      {/* Footer note */}
      <s-text tone="subdued" variant="bodySm">
        Names come from Shopify when this page loads. The app stores only Shopify IDs.
      </s-text>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
