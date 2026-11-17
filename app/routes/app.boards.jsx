import { useLoaderData, useNavigate, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getAuditBoards,
  getBoardSummaryCounts,
  fetchCustomerNames,
  fetchVariantData,
} from "../services/audit.server.js";
import { SAVED_VIEWS, SORT_OPTIONS } from "../models/boards-list.shared.js";
import { getSettings } from "../models/settings.server.js";
import { AVATAR_SPRITE } from "../models/avatars.shared.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  // Parse all URL params
  const params = {
    view: url.searchParams.get("view") || "all",
    q: url.searchParams.get("q") || "",
    status: url.searchParams.get("status") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    dateRange: url.searchParams.get("dateRange") || undefined,
    hasOrder: url.searchParams.get("order") || undefined,
    shopperType: url.searchParams.get("type") || undefined,
    via: url.searchParams.get("via") || undefined,
    productId: url.searchParams.get("product") || undefined,
    reason: url.searchParams.get("reason") || undefined,
    pieces: url.searchParams.get("pieces") || undefined,
    voterCount: url.searchParams.get("voters") || undefined,
    hidePrices: url.searchParams.get("hidePrices") || undefined,
    sort: url.searchParams.get("sort") || "newest",
    page: parseInt(url.searchParams.get("page") || "1", 10),
  };

  const start = Date.now();
  const [{ boards, total, page, pageCount }, counts, settings] = await Promise.all([
    getAuditBoards(shop, params, admin),
    getBoardSummaryCounts(shop, { from: params.from, to: params.to }),
    getSettings(shop),
  ]);
  const loaderMs = Date.now() - start;

  // Collect IDs for live lookups
  const customerIds = new Set();
  const variantIds = new Set();

  for (const b of boards) {
    if (b.shopperCustomerId) customerIds.add(b.shopperCustomerId);
    if (b.order?.customerId) customerIds.add(b.order.customerId);
    for (const item of b.items.slice(0, 3)) {
      if (item.variantId) variantIds.add(item.variantId);
    }
  }

  // Fetch names and thumbnails in parallel
  const [customerResult, variantResult] = await Promise.all([
    fetchCustomerNames(admin, Array.from(customerIds)),
    fetchVariantData(admin, Array.from(variantIds)),
  ]);

  // Attach data
  for (const b of boards) {
    b.shopperName = b.shopperCustomerId
      ? customerResult.map.get(b.shopperCustomerId) || "Customer"
      : b.shopperFirstName || "Guest";
    b.isGuest = !b.shopperCustomerId;

    if (b.order?.customerId) {
      b.order.customerName = customerResult.map.get(b.order.customerId) || "Customer";
    } else if (b.order) {
      b.order.customerName = "Guest checkout";
    }

    // Add thumbnails for first 3 items
    b.thumbnails = [];
    for (const item of b.items.slice(0, 3)) {
      const data = variantResult.map.get(item.variantId);
      if (data?.imageUrl) {
        b.thumbnails.push(data.imageUrl);
      }
    }
  }

  return {
    boards,
    total,
    page,
    pageCount,
    counts,
    params,
    loaderMs,
    reasonChips: settings.reasonChips,
  };
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

// Format date with relative time
function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (diffHours < 24) {
    return `${formatted} · ${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${formatted} · ${diffDays}d ago`;
  }
  return formatted;
}

// Format expiry with urgency
function formatExpiry(expiresAt, isVoted) {
  if (!expiresAt || isVoted) return null;
  const date = new Date(expiresAt);
  const now = new Date();
  const diffMs = date - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return null; // Expired, shown in status
  if (diffDays <= 3) {
    return { text: `in ${diffDays}d`, urgent: true };
  }
  return {
    text: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    urgent: false,
  };
}

// Extract numeric ID from GID for admin links
function numericId(gid) {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

// Build URL with updated params
function buildUrl(baseParams, updates) {
  const params = new URLSearchParams();
  const merged = { ...baseParams, ...updates };

  // Only include non-empty values
  for (const [key, value] of Object.entries(merged)) {
    if (value && value !== "all" && value !== "newest" && key !== "page") {
      params.set(key, value);
    }
  }
  // Always include page if > 1
  if (merged.page && merged.page > 1) {
    params.set("page", merged.page);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Date range options
const DATE_RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

// Status options
const STATUS_OPTIONS = [
  { value: "waiting", label: "Waiting for votes" },
  { value: "partly", label: "Partly voted" },
  { value: "voted", label: "Voted" },
  { value: "expired", label: "Expired" },
];

// Order options
const ORDER_OPTIONS = [
  { value: "yes", label: "Has order" },
  { value: "no", label: "No order" },
];

// Shopper type options
const SHOPPER_OPTIONS = [
  { value: "customer", label: "Logged-in" },
  { value: "guest", label: "Guest" },
];

// Via (share channel) options
const VIA_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "copy", label: "Copy link" },
  { value: "native", label: "Share sheet" },
];

// Pieces options
const PIECES_OPTIONS = [
  { value: "1-2", label: "1–2 pieces" },
  { value: "3-5", label: "3–5 pieces" },
  { value: "6+", label: "6+ pieces" },
];

// Voter count options
const VOTER_COUNT_OPTIONS = [
  { value: "1", label: "1 voter" },
  { value: "2-3", label: "2–3 voters" },
  { value: "4-5", label: "4–5 voters" },
];

// Hide prices options
const HIDE_PRICES_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// Build reason options from per-verdict chips
function buildReasonOptions(reasonChips) {
  const options = [];
  // PASS chips = "Not For Us"
  const passChips = reasonChips?.pass || [];
  const maybeChips = reasonChips?.maybe || [];
  if (passChips.length > 0) {
    options.push({ group: "Not For Us", items: passChips.map(c => ({
      value: c.code,
      label: c.active ? c.label : `${c.label} (retired)`,
    })) });
  }
  if (maybeChips.length > 0) {
    options.push({ group: "Maybe", items: maybeChips.map(c => ({
      value: c.code,
      label: c.active ? c.label : `${c.label} (retired)`,
    })) });
  }
  options.push({ group: null, items: [{ value: "other", label: "Other" }] });
  return options;
}

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
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: 500,
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}

// Voter faces: now uses shared component
import { VoterFaces } from "../components/VoterFaces.jsx";
/* eslint-enable react/prop-types */

export default function BoardsPage() {
  const { boards, total, page, pageCount, counts, params, loaderMs, reasonChips } = useLoaderData();
  const navigate = useNavigate();
  const reasonOptions = buildReasonOptions(reasonChips);

  const handleSearch = (e) => {
    e.preventDefault();
    const form = e.target;
    const q = form.q.value.trim();
    navigate(buildUrl(params, { q, page: 1 }));
  };

  const handleClearSearch = () => {
    navigate(buildUrl(params, { q: "", page: 1 }));
  };

  const handleViewChange = (view) => {
    navigate(buildUrl({ view }, { page: 1 }));
  };

  const handleSortChange = (sort) => {
    navigate(buildUrl(params, { sort, page: 1 }));
  };

  const handlePageChange = (newPage) => {
    navigate(buildUrl(params, { page: newPage }));
  };

  const handleRowClick = (boardId) => {
    // Preserve current filters in the URL for back navigation
    const currentUrl = buildUrl(params, {});
    navigate(`/app/boards/${boardId}${currentUrl ? `?back=${encodeURIComponent(currentUrl)}` : ""}`);
  };

  // Filter handlers
  const handleFilterChange = (key, value) => {
    navigate(buildUrl(params, { [key]: value || undefined, page: 1 }));
  };

  // Active filters for display
  const activeFilters = [];
  if (params.dateRange && params.dateRange !== "all") {
    const label = DATE_RANGE_OPTIONS.find((o) => o.value === params.dateRange)?.label || params.dateRange;
    activeFilters.push({
      key: "dateRange",
      label,
      clear: () => navigate(buildUrl(params, { dateRange: undefined, page: 1 })),
    });
  } else if (params.from || params.to) {
    activeFilters.push({
      key: "date",
      label: params.from && params.to ? `${params.from} – ${params.to}` : params.from || params.to,
      clear: () => navigate(buildUrl(params, { from: undefined, to: undefined, page: 1 })),
    });
  }
  if (params.status) {
    const label = STATUS_OPTIONS.find((o) => o.value === params.status)?.label || params.status;
    activeFilters.push({
      key: "status",
      label: `Status: ${label}`,
      clear: () => navigate(buildUrl(params, { status: undefined, page: 1 })),
    });
  }
  if (params.hasOrder) {
    activeFilters.push({
      key: "order",
      label: params.hasOrder === "yes" ? "Has order" : "No order",
      clear: () => navigate(buildUrl(params, { hasOrder: undefined, page: 1 })),
    });
  }
  if (params.shopperType) {
    activeFilters.push({
      key: "type",
      label: params.shopperType === "customer" ? "Logged-in" : "Guest",
      clear: () => navigate(buildUrl(params, { shopperType: undefined, page: 1 })),
    });
  }
  if (params.via) {
    const label = VIA_OPTIONS.find((o) => o.value === params.via)?.label || params.via;
    activeFilters.push({
      key: "via",
      label: `Via: ${label}`,
      clear: () => navigate(buildUrl(params, { via: undefined, page: 1 })),
    });
  }
  if (params.pieces) {
    const label = PIECES_OPTIONS.find((o) => o.value === params.pieces)?.label || params.pieces;
    activeFilters.push({
      key: "pieces",
      label,
      clear: () => navigate(buildUrl(params, { pieces: undefined, page: 1 })),
    });
  }
  if (params.voterCount) {
    const label = VOTER_COUNT_OPTIONS.find((o) => o.value === params.voterCount)?.label || params.voterCount;
    activeFilters.push({
      key: "voters",
      label,
      clear: () => navigate(buildUrl(params, { voterCount: undefined, page: 1 })),
    });
  }
  if (params.hidePrices) {
    activeFilters.push({
      key: "hidePrices",
      label: `Prices hidden: ${params.hidePrices}`,
      clear: () => navigate(buildUrl(params, { hidePrices: undefined, page: 1 })),
    });
  }
  if (params.reason) {
    activeFilters.push({
      key: "reason",
      label: `Reason: ${params.reason}`,
      clear: () => navigate(buildUrl(params, { reason: undefined, page: 1 })),
    });
  }
  if (params.productId) {
    activeFilters.push({
      key: "product",
      label: "Product filter active",
      clear: () => navigate(buildUrl(params, { productId: undefined, page: 1 })),
    });
  }

  const clearAllFilters = () => {
    navigate(buildUrl({ view: params.view, q: params.q, sort: params.sort }, {}));
  };

  // Pagination info
  const startItem = (page - 1) * 25 + 1;
  const endItem = Math.min(page * 25, total);

  return (
    <s-page heading="Boards">
      <s-button slot="secondary-actions" variant="plain">
        <Link to="/app/analytics" style={{ textDecoration: "none", color: "inherit" }}>
          Analytics
        </Link>
      </s-button>

      <style>{`
        .pvb-summary-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
        .pvb-summary-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 12px 16px; text-align: center; }
        .pvb-summary-value { font-size: 24px; font-weight: 600; color: #202223; }
        .pvb-summary-label { font-size: 12px; color: #6d7175; margin-top: 2px; }
        .pvb-summary-range { font-size: 11px; color: #8c9196; margin-top: 4px; }
        .pvb-tabs { display: flex; gap: 0; border-bottom: 1px solid #e1e3e5; margin-bottom: 16px; overflow-x: auto; }
        .pvb-tab { padding: 12px 16px; font-size: 13px; color: #6d7175; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; background: none; border-top: none; border-left: none; border-right: none; }
        .pvb-tab:hover { color: #202223; }
        .pvb-tab[data-active="true"] { color: #202223; border-bottom-color: #485B59; font-weight: 600; background: #f6f6f7; }
        .pvb-controls-row1 { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
        .pvb-search { flex: 1; }
        .pvb-search-input { width: 100%; padding: 8px 12px 8px 36px; border: 1px solid #c9cccf; border-radius: 8px; font-size: 14px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236d7175'%3E%3Cpath d='M11.5 11.5L15 15M7 13A6 6 0 107 1a6 6 0 000 12z' stroke='%236d7175' stroke-width='1.5' fill='none'/%3E%3C/svg%3E") 12px center no-repeat; }
        .pvb-controls-row2 { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        .pvb-sort-select { padding: 6px 28px 6px 10px; border: 1px solid #c9cccf; border-radius: 6px; font-size: 13px; background: #fff; height: 32px; }
        .pvb-filter-select { padding: 6px 24px 6px 10px; border: 1px solid #c9cccf; border-radius: 6px; font-size: 13px; background: #fff; height: 32px; min-width: 90px; }
        .pvb-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .pvb-filter-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid #d3d3d3; border-radius: 16px; font-size: 12px; color: #202223; background: #f6f6f7; }
        .pvb-filter-clear { background: none; border: none; cursor: pointer; font-size: 14px; color: #6d7175; padding: 0 2px; }
        .pvb-clear-all { font-size: 12px; color: #485B59; cursor: pointer; background: none; border: none; text-decoration: underline; }
        .pvb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pvb-table th { text-align: left; padding: 12px 8px; border-bottom: 1px solid #e1e3e5; color: #6d7175; font-weight: 500; }
        .pvb-table td { padding: 12px 8px; border-bottom: 1px solid #e1e3e5; color: #202223; }
        .pvb-table tr:hover { background: #f9fafb; cursor: pointer; }
        .pvb-table a { color: #485B59; text-decoration: none; }
        .pvb-table a:hover { text-decoration: underline; }
        .pvb-date-link { font-weight: 500; }
        .pvb-thumbnails { display: flex; gap: 4px; }
        .pvb-thumb { width: 32px; height: 32px; border-radius: 4px; object-fit: cover; border: 1px solid #e1e3e5; }
        .pvb-thumb-more { width: 32px; height: 32px; border-radius: 4px; background: #f6f6f7; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #6d7175; }
        .pvb-votes { display: flex; flex-direction: column; gap: 2px; }
        .pvb-votes-loved { color: #485B59; font-weight: 500; }
        .pvb-votes-other { color: #6d7175; font-size: 12px; }
        .pvb-expiry-urgent { color: #A40713; font-weight: 500; }
        .pvb-guest { color: #6d7175; font-style: italic; }
        .pvb-voters { display: flex; align-items: center; gap: 8px; }
        .pvb-voter-faces { display: flex; }
        .pvb-voter-face { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; margin-left: -6px; overflow: hidden; }
        .pvb-voter-face:first-child { margin-left: 0; }
        .pvb-voter-face[data-done="true"] { box-shadow: 0 0 0 2px #485B59; }
        .pvb-voter-face[data-done="false"] { opacity: 0.5; }
        .pvb-voter-summary { font-size: 11px; color: #6d7175; white-space: nowrap; }
        .pvb-badge-prices-hidden { display: inline-block; margin-left: 6px; padding: 2px 6px; border-radius: 4px; font-size: 11px; background: #F1F1F1; color: #6D7175; }
        .pvb-pagination { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; }
        .pvb-pagination-info { font-size: 13px; color: #6d7175; }
        .pvb-pagination-btns { display: flex; gap: 8px; }
        .pvb-empty { text-align: center; padding: 48px 24px; color: #6d7175; }
        .pvb-empty-title { font-size: 15px; font-weight: 500; color: #202223; margin-bottom: 8px; }
        @media (max-width: 900px) {
          .pvb-summary-strip { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 600px) {
          .pvb-summary-strip { grid-template-columns: repeat(2, 1fr); }
          .pvb-table { font-size: 12px; }
          .pvb-table th, .pvb-table td { padding: 8px 4px; }
        }
      `}</style>

      {/* Avatar sprite (hidden) */}
      <div dangerouslySetInnerHTML={{ __html: AVATAR_SPRITE }} />

      {/* Summary strip - 5 cards */}
      <div className="pvb-summary-strip">
        <div className="pvb-summary-card">
          <div className="pvb-summary-value">{counts.shared}</div>
          <div className="pvb-summary-label">Shared</div>
          <div className="pvb-summary-range">{params.dateRange ? DATE_RANGE_OPTIONS.find(o => o.value === params.dateRange)?.label : "All time"}</div>
        </div>
        <div className="pvb-summary-card">
          <div className="pvb-summary-value">{counts.waiting}</div>
          <div className="pvb-summary-label">Waiting</div>
        </div>
        <div className="pvb-summary-card">
          <div className="pvb-summary-value">{counts.partlyVoted}</div>
          <div className="pvb-summary-label">Partly voted</div>
        </div>
        <div className="pvb-summary-card">
          <div className="pvb-summary-value">{counts.voted}</div>
          <div className="pvb-summary-label">Voted</div>
        </div>
        <div className="pvb-summary-card">
          <div className="pvb-summary-value">{counts.ordered}</div>
          <div className="pvb-summary-label">With an order</div>
        </div>
      </div>

      {/* Saved view tabs */}
      <div className="pvb-tabs">
        {Object.entries(SAVED_VIEWS).map(([key, { label }]) => (
          <button
            key={key}
            className="pvb-tab"
            data-active={params.view === key}
            onClick={() => handleViewChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Row 1: Search + Sort */}
      <div className="pvb-controls-row1">
        <form onSubmit={handleSearch} className="pvb-search">
          <input
            type="text"
            name="q"
            className="pvb-search-input"
            placeholder="Search voter, shopper, order #, product…"
            defaultValue={params.q}
          />
        </form>
        <select
          className="pvb-sort-select"
          value={params.sort}
          onChange={(e) => handleSortChange(e.target.value)}
        >
          {Object.entries(SORT_OPTIONS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Row 2: Filter selects */}
      <div className="pvb-controls-row2">
        <select
          className="pvb-filter-select"
          value={params.dateRange || ""}
          onChange={(e) => handleFilterChange("dateRange", e.target.value)}
        >
          <option value="">Date range</option>
          {DATE_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.status || ""}
          onChange={(e) => handleFilterChange("status", e.target.value)}
        >
          <option value="">Status</option>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.hasOrder || ""}
          onChange={(e) => handleFilterChange("hasOrder", e.target.value)}
        >
          <option value="">Order</option>
          {ORDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.shopperType || ""}
          onChange={(e) => handleFilterChange("shopperType", e.target.value)}
        >
          <option value="">Shopper</option>
          {SHOPPER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.via || ""}
          onChange={(e) => handleFilterChange("via", e.target.value)}
        >
          <option value="">Via</option>
          {VIA_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.pieces || ""}
          onChange={(e) => handleFilterChange("pieces", e.target.value)}
        >
          <option value="">Pieces</option>
          {PIECES_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.voterCount || ""}
          onChange={(e) => handleFilterChange("voterCount", e.target.value)}
        >
          <option value="">Voters</option>
          {VOTER_COUNT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className="pvb-filter-select"
          value={params.hidePrices || ""}
          onChange={(e) => handleFilterChange("hidePrices", e.target.value)}
        >
          <option value="">Prices hidden</option>
          {HIDE_PRICES_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Reason filter with optgroups */}
        <select
          className="pvb-filter-select"
          value={params.reason || ""}
          onChange={(e) => handleFilterChange("reason", e.target.value)}
        >
          <option value="">Reason</option>
          {reasonOptions.map((group, gi) =>
            group.group ? (
              <optgroup key={gi} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </optgroup>
            ) : (
              group.items.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))
            )
          )}
        </select>
      </div>

      {/* Active filter pills */}
      {(activeFilters.length > 0 || params.q) && (
        <div className="pvb-filters">
          {params.q && (
            <span className="pvb-filter-pill">
              Search: {params.q}
              <button className="pvb-filter-clear" onClick={handleClearSearch}>
                ✕
              </button>
            </span>
          )}
          {activeFilters.map((f) => (
            <span key={f.key} className="pvb-filter-pill">
              {f.label}
              <button className="pvb-filter-clear" onClick={f.clear}>
                ✕
              </button>
            </span>
          ))}
          {(activeFilters.length > 0 || params.q) && (
            <button className="pvb-clear-all" onClick={clearAllFilters}>
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Boards table */}
      {boards.length === 0 ? (
        <s-card>
          <div className="pvb-empty">
            <div className="pvb-empty-title">No boards match these filters</div>
            {(activeFilters.length > 0 || params.q || params.view !== "all") && (
              <s-button variant="plain" onClick={clearAllFilters}>
                Clear filters
              </s-button>
            )}
          </div>
        </s-card>
      ) : (
        <s-card>
          <table className="pvb-table">
            <thead>
              <tr>
                <th>Board</th>
                <th>Shopper</th>
                <th>Voters</th>
                <th>Pieces</th>
                <th>Votes</th>
                <th>Status</th>
                <th>Order</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => {
                const expiry = formatExpiry(b.expiresAt, b.status === "Voted" || b.status === "Ordered");
                const detailUrl = `/app/boards/${b.id}${buildUrl(params, {}) ? `?back=${encodeURIComponent(buildUrl(params, {}))}` : ""}`;
                return (
                  <tr key={b.id} onClick={() => handleRowClick(b.id)}>
                    <td>
                      <Link to={detailUrl} className="pvb-date-link" onClick={(e) => e.stopPropagation()}>
                        {formatDate(b.sharedAt)}
                      </Link>
                    </td>
                    <td>
                      {b.shopperCustomerId ? (
                        <a
                          href={`shopify:admin/customers/${numericId(b.shopperCustomerId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.shopperName}
                        </a>
                      ) : (
                        <span className="pvb-guest">{b.shopperName}</span>
                      )}
                    </td>
                    <td>
                      <VoterFaces voters={b.voters} summary={b.voterSummary} />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {b.thumbnails.length > 0 && (
                          <div className="pvb-thumbnails">
                            {b.thumbnails.map((url, i) => (
                              <img key={i} src={url} alt="" className="pvb-thumb" />
                            ))}
                            {b.pieceCount > 3 && (
                              <span className="pvb-thumb-more">+{b.pieceCount - 3}</span>
                            )}
                          </div>
                        )}
                        {b.thumbnails.length === 0 && <span>{b.pieceCount}</span>}
                      </div>
                    </td>
                    <td>
                      {b.loveCount + b.maybeCount + b.passCount > 0 ? (
                        <div className="pvb-votes">
                          {b.loveCount > 0 && (
                            <span className="pvb-votes-loved">{b.loveCount} loved</span>
                          )}
                          {(b.maybeCount > 0 || b.passCount > 0) && (
                            <span className="pvb-votes-other">
                              {[
                                b.maybeCount > 0 ? `${b.maybeCount} maybe` : null,
                                b.passCount > 0 ? `${b.passCount} no` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "#6d7175" }}>No votes yet</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={b.status} tone={b.statusTone} />
                      {b.hidePrices && (
                        <span className="pvb-badge-prices-hidden">Prices hidden</span>
                      )}
                    </td>
                    <td>
                      {b.order ? (
                        <a
                          href={`shopify:admin/orders/${numericId(b.order.orderId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.order.orderName}
                          <br />
                          <span style={{ color: "#6d7175", fontSize: "12px" }}>
                            {formatCurrency(b.order.valueCents, b.order.currencyCode)}
                          </span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {expiry ? (
                        <span className={expiry.urgent ? "pvb-expiry-urgent" : ""}>
                          {expiry.text}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="pvb-pagination">
            <div className="pvb-pagination-info">
              Showing {startItem}–{endItem} of {total} boards
              {loaderMs && <span style={{ marginLeft: 8, color: "#8c9196" }}>({loaderMs}ms)</span>}
            </div>
            <div className="pvb-pagination-btns">
              <s-button
                variant="secondary"
                disabled={page <= 1 || undefined}
                onClick={() => handlePageChange(page - 1)}
              >
                Previous
              </s-button>
              <s-button
                variant="secondary"
                disabled={page >= pageCount || undefined}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
              </s-button>
            </div>
          </div>
        </s-card>
      )}

      {/* Footer note */}
      <s-text tone="subdued" variant="bodySm">
        Names and images come from Shopify when this page loads. The app stores only Shopify IDs.
      </s-text>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
