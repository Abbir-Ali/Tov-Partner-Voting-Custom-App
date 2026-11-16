import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getTopBoardCustomers,
  fetchCustomerNames,
} from "../services/audit.server.js";
import { parseRange } from "../services/dashboard.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const days = parseRange(url.searchParams.get("days"));
  const repeatOnly = url.searchParams.get("repeat") === "true";

  // Get top customers (larger limit for the dedicated page)
  const topCustomers = await getTopBoardCustomers(shop, days, 25);

  // Filter to repeat only if requested
  let customers = topCustomers.customers;
  if (repeatOnly) {
    customers = customers.filter((c) => c.isRepeat);
  }

  // Fetch names
  const customerIds = customers.map((c) => c.customerId);
  const { map: customerNameMap, ok: customerNamesOk } = await fetchCustomerNames(
    admin,
    customerIds
  );

  // Attach names
  for (const c of customers) {
    const name = customerNameMap.get(c.customerId);
    if (name) {
      c.displayName = name;
    } else if (customerNamesOk) {
      const idNum = c.customerId.split("/").pop();
      c.displayName = `Customer #${idNum}`;
    } else {
      c.displayName = "Customer";
    }
  }

  return {
    customers,
    guestCount: topCustomers.guestCount,
    days,
    repeatOnly,
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

export default function CustomersPage() {
  const { customers, guestCount, days, repeatOnly } = useLoaderData();

  return (
    <s-page heading="Customers">
      <style>{`
        .pvb-customer-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .pvb-customer-table th { text-align: left; padding: 12px 8px; border-bottom: 1px solid #e1e3e5; color: #6d7175; font-weight: 500; }
        .pvb-customer-table td { padding: 12px 8px; border-bottom: 1px solid #e1e3e5; color: #3F3D3E; }
        .pvb-customer-table a { color: #485B59; text-decoration: none; }
        .pvb-customer-table a:hover { text-decoration: underline; }
        .pvb-repeat-badge { display: inline-block; background: #485B59; color: #FEFBF6; font-size: 10px; padding: 2px 6px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 8px; }
        .pvb-guest-note { font-size: 13px; color: #6d7175; margin-top: 16px; }
        .pvb-empty { color: #6d7175; font-size: 13px; font-style: italic; padding: 24px 0; text-align: center; }
        .pvb-settings-link { display: inline-block; margin-top: 16px; font-size: 13px; color: #485B59; text-decoration: none; }
        .pvb-settings-link:hover { text-decoration: underline; }
        .pvb-filter-groups { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
      `}</style>

      <s-section>
        {/* Filters - Polaris segmented button groups */}
        <div className="pvb-filter-groups">
          <s-button-group variant="segmented">
            {[7, 14, 30, 60].map((d) => (
              <s-button
                key={d}
                variant={days === d ? "primary" : undefined}
                onClick={() => window.location.href = `?days=${d}${repeatOnly ? "&repeat=true" : ""}`}
              >
                {d} days
              </s-button>
            ))}
          </s-button-group>

          <s-button-group variant="segmented">
            <s-button
              variant={!repeatOnly ? "primary" : undefined}
              onClick={() => window.location.href = `?days=${days}`}
            >
              All
            </s-button>
            <s-button
              variant={repeatOnly ? "primary" : undefined}
              onClick={() => window.location.href = `?days=${days}&repeat=true`}
            >
              Repeat Buyers
            </s-button>
          </s-button-group>
        </div>

        {customers.length > 0 ? (
          <>
            <table className="pvb-customer-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th style={{ textAlign: "right" }}>Board Orders</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c, idx) => {
                  const numericId = c.customerId.split("/").pop();
                  return (
                    <tr key={idx}>
                      <td>
                        <a
                          href={`shopify:admin/customers/${numericId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {c.displayName}
                        </a>
                        {c.isRepeat && <span className="pvb-repeat-badge">Repeat</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>{c.orders}</td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(c.revenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {guestCount > 0 && !repeatOnly && (
              <p className="pvb-guest-note">
                + {guestCount} guest checkout{guestCount !== 1 ? "s" : ""} (not shown)
              </p>
            )}
          </>
        ) : (
          <p className="pvb-empty">
            {repeatOnly
              ? "No repeat board buyers yet in this period."
              : "No orders from boards yet in this period."}
          </p>
        )}

        <Link to="/app/settings/customers" className="pvb-settings-link">
          Tag past board buyers →
        </Link>
      </s-section>

      <s-text tone="subdued" variant="bodySm">
        Names come from Shopify when this page loads. The app stores only Shopify IDs.
      </s-text>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
