import { authenticate } from "../shopify.server";
import db from "../db.server";
import { log } from "../utils/log.server.js";

export const action = async ({ request }) => {
  const { payload, session, shop } = await authenticate.webhook(request);

  log.info("webhook.scopes_update", { shop });
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  return new Response();
};
