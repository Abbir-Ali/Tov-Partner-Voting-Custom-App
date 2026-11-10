import { authenticate } from "../shopify.server";
import { escapeForLiquid } from "../utils/escape.server";

/**
 * Splat route: handles /proxy and /proxy/* via the App Proxy at /apps/board.
 *
 * authenticate.public.appProxy throws a Response automatically when the
 * Shopify HMAC signature is missing or invalid, so the page is never
 * rendered for unsigned requests.
 */
export const loader = async ({ request, params }) => {
  const { liquid } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
  const pathPrefix = url.searchParams.get("path_prefix") ?? "";
  const splat = params["*"] ?? "";

  const body = `
<div style="max-width:640px;margin:48px auto;padding:24px;
  font-family:Montserrat,sans-serif;color:#3F3D3E;
  background:#FEFBF6;border-radius:16px">
  <p style="font-size:12px;font-weight:700;letter-spacing:0.045em;
    text-transform:uppercase;color:#82736C">App Proxy Test</p>
  <h1>Proxy is working</h1>
  <p>Shop: ${escapeForLiquid(shop)}</p>
  <p>Path: ${escapeForLiquid(splat) || "(root)"}</p>
  <p>Customer logged in: ${loggedInCustomerId ? "yes" : "no"}</p>
  <p>Path prefix: ${escapeForLiquid(pathPrefix)}</p>
</div>`;

  return liquid(body, { headers: { "Cache-Control": "no-store" } });
};
