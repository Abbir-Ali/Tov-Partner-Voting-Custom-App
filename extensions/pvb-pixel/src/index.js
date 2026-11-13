/**
 * PVB Web Pixel: subscribes to pvb_* custom events and sends to ingest endpoint.
 * Runs in the Web Pixel sandbox with analytics=true customer privacy.
 * Sends raw clientId to server; hashing happens server-side with the secret salt.
 */
import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init, settings }) => {
  // Get shop domain from init data
  const shop = init.data?.shop?.myshopifyDomain || settings.accountID || "";
  const ingestUrl = settings.ingestUrl || "";
  const key = settings.key || "";

  // DEBUG - log pixel load
  console.log("[pvb-pixel] loaded", shop, ingestUrl ? "has_url" : "no_url");

  if (!ingestUrl || !key) {
    console.warn("[pvb-pixel] missing ingestUrl or key");
    return;
  }

  // Send event to ingest endpoint with shop and key
  // Uses fetch with keepalive, Content-Type text/plain to avoid preflight
  async function sendEvent(type, payload, clientId) {
    const body = JSON.stringify({
      type,
      clientId: clientId || null,
      shop,
      key,
      ...payload,
    });
    // DEBUG - log before send
    console.log("[pvb-pixel] send", ingestUrl, type);
    try {
      const result = await fetch(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        keepalive: true,
      });
      // DEBUG - log result
      console.log("[pvb-pixel] fetch result", result.ok, result.status);
    } catch (err) {
      // DEBUG - log error
      console.error("[pvb-pixel] fetch error", err);
    }
  }

  // Subscribe to PVB custom events
  const eventMap = {
    pvb_button_impression: "button_impression",
    pvb_button_save: "button_save",
    pvb_button_unsave: "button_unsave",
    pvb_drawer_open: "drawer_open",
    pvb_share_open: "share_open",
    pvb_share_channel: "share_channel",
    pvb_drawer_add_all: "drawer_add_all",
  };

  for (const [customEvent, eventType] of Object.entries(eventMap)) {
    analytics.subscribe(customEvent, (event) => {
      // DEBUG - log received event
      console.log("[pvb-pixel] got", customEvent, event.customData);
      const data = event.customData || {};
      const payload = {};

      if (data.boardId) payload.boardId = data.boardId;
      if (data.channel) payload.meta = { channel: data.channel };

      sendEvent(eventType, payload, event.clientId);
    });
  }
});
