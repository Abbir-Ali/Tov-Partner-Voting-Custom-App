/**
 * PVB Web Pixel: subscribes to pvb_* custom events and sends to ingest endpoint.
 * Runs in the Web Pixel sandbox with analytics=true customer privacy.
 * Sends raw clientId to server; hashing happens server-side with the secret salt.
 */
import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init }) => {
  const origin = init.context.document.location.origin;
  const endpoint = `${origin}/apps/board/api/events`;

  // DEBUG - log pixel load
  console.log("[pvb-pixel] loaded", origin);

  // Send event to ingest endpoint with raw clientId
  // Uses fetch with keepalive (sendBeacon is deprecated in Web Pixels API)
  async function sendEvent(type, payload, clientId) {
    const body = JSON.stringify({
      type,
      clientId: clientId || null,
      ...payload,
    });
    // DEBUG - log before send
    console.log("[pvb-pixel] send", endpoint, body);
    try {
      const result = await fetch(endpoint, {
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
