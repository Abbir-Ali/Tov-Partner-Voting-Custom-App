import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

// What the app stores (read-only info)
const DATA_STORED = [
  {
    category: "Board data",
    items: [
      "Product and variant IDs for saved pieces",
      "Shopper's first name (from share form)",
      "Shopper's email (for voting-done notification only)",
      "Partner's first name (from share form)",
    ],
  },
  {
    category: "Votes",
    items: [
      "Partner's verdict (Love, Maybe, Not For Us)",
      "Optional reason chip or free-text reason",
      "Timestamp",
    ],
  },
  {
    category: "Order attribution",
    items: [
      "Shopify order ID and customer ID (for analytics)",
      "Order value (for revenue reporting)",
    ],
  },
];

const NOT_STORED = [
  "Partner's email address",
  "Partner's IP address or device info",
  "Notes from shoppers (displayed to partner only, not stored)",
  "Full customer profiles",
];

export default function PrivacySettings() {
  return (
    <s-page
      heading="Privacy"
      back-action={JSON.stringify({ url: "/app/settings" })}
    >
      <style>{`
        .pvb-settings-layout { display: grid; grid-template-columns: 280px 1fr; gap: 40px; }
        @media (max-width: 800px) { .pvb-settings-layout { grid-template-columns: 1fr; gap: 16px; } }
        .pvb-settings-help h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #202223; }
        .pvb-settings-help p { font-size: 13px; color: #6d7175; line-height: 1.5; margin: 0; }
        .pvb-data-list { margin: 0; padding: 0; list-style: none; }
        .pvb-data-category { font-weight: 600; font-size: 13px; color: #202223; margin: 16px 0 8px; }
        .pvb-data-category:first-child { margin-top: 0; }
        .pvb-data-item { font-size: 13px; color: #6d7175; padding: 4px 0; padding-left: 16px; position: relative; }
        .pvb-data-item::before { content: "•"; position: absolute; left: 0; color: #8c9196; }
        .pvb-not-stored { margin-top: 24px; padding: 16px; background: #f6f6f7; border-radius: 8px; }
        .pvb-not-stored h4 { font-size: 13px; font-weight: 600; color: #202223; margin: 0 0 8px; }
        .pvb-retention { margin-top: 24px; padding: 16px; background: #fff8e5; border-radius: 8px; border: 1px solid #ffc96b; }
        .pvb-retention h4 { font-size: 13px; font-weight: 600; color: #573b00; margin: 0 0 8px; }
        .pvb-retention p { font-size: 13px; color: #573b00; margin: 0; }
      `}</style>

      <s-section>
        <div className="pvb-settings-layout">
          <div className="pvb-settings-help">
            <h3>What the App Stores</h3>
            <p>
              Partner Voting Board stores the minimum data needed to show boards
              and track which orders came from shared boards. Customer names are
              fetched from Shopify when needed, not stored.
            </p>
          </div>
          <div>
            <ul className="pvb-data-list">
              {DATA_STORED.map((category) => (
                <li key={category.category}>
                  <div className="pvb-data-category">{category.category}</div>
                  {category.items.map((item, i) => (
                    <div key={i} className="pvb-data-item">
                      {item}
                    </div>
                  ))}
                </li>
              ))}
            </ul>

            <div className="pvb-not-stored">
              <h4>Never stored</h4>
              {NOT_STORED.map((item, i) => (
                <div key={i} className="pvb-data-item">
                  {item}
                </div>
              ))}
            </div>

            <div className="pvb-retention">
              <h4>Data Retention</h4>
              <p>
                Data retention settings will be added in a future update. For
                now, board data expires after the configured expiry period (default
                30 days), but analytics data is kept for reporting.
              </p>
            </div>
          </div>
        </div>
      </s-section>

      <s-section>
        <div className="pvb-settings-layout">
          <div className="pvb-settings-help">
            <h3>Shopify Privacy</h3>
            <p>
              This app follows Shopify&apos;s data protection requirements and will
              respond to customer data requests.
            </p>
          </div>
          <div>
            <s-link
              href="https://help.shopify.com/en/manual/privacy-and-security/privacy"
              external
            >
              Shopify privacy documentation
            </s-link>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
