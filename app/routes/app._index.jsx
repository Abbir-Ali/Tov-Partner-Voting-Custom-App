import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  syncStorefrontConfig,
  needsSync,
} from "../services/storefront-config.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Self-heal: sync storefront config if needed
  let syncOk = true;
  if (await needsSync(session.shop)) {
    const result = await syncStorefrontConfig(admin, session.shop);
    syncOk = result.ok;
  }

  return { syncOk };
};

export default function Index() {
  const { syncOk } = useLoaderData();

  return (
    <s-page heading="Partner Voting Board">
      {!syncOk && (
        <s-banner tone="warning" heading="Storefront settings didn't sync">
          <Link to="/app/settings">Save Settings</Link> to try again.
        </s-banner>
      )}
      <s-section>
        <s-paragraph>
          Shoppers share boards and partners vote on the storefront. Settings
          and stats will appear here.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
