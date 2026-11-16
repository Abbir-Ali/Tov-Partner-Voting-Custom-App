import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

// How it works steps
const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Shopper saves pieces",
    description:
      "A shopper saves furniture pieces to their board using the heart button on product pages.",
  },
  {
    step: 2,
    title: "Shopper shares the board",
    description:
      "They share the board with their partner via WhatsApp, SMS, email, or a link.",
  },
  {
    step: 3,
    title: "Partner votes",
    description:
      "The partner opens the link (no account needed) and swipes Love, Maybe, or Not For Us on each piece.",
  },
  {
    step: 4,
    title: "Shopper sees results",
    description:
      "When voting is done, the shopper gets an email. They tap to see what their partner loved and add it to cart.",
  },
];

// Testing tips
const TESTING_TIPS = [
  {
    title: "Use a dev tunnel",
    description:
      "Run `shopify app dev` (not --use-localhost). The vote page and webhooks need the tunnel URL.",
  },
  {
    title: "Enable the feature",
    description:
      'Go to Settings → General and turn on "Enable Partner Voting Board". Save settings once to sync.',
  },
  {
    title: "Enable the app embed",
    description:
      'In the theme editor, go to App embeds and toggle on "Your Board". Add the Save to Board block to your product template.',
  },
  {
    title: "Test the full flow",
    description:
      "Save a product, open the drawer, share it to yourself, vote on the link, then check that the email arrives (if Klaviyo is connected).",
  },
  {
    title: "Sidekick preview",
    description:
      "Open the Dev Console (Ctrl+Shift+D), find pvb-sidekick, and click admin.app.tools.data to enable Sidekick.",
  },
];

export default function HelpPage() {
  return (
    <s-page heading="Help">
      <style>{`
        .pvb-help-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .pvb-help-card h3 { font-size: 15px; font-weight: 600; margin: 0 0 16px; color: #202223; }
        .pvb-step { display: flex; gap: 16px; margin-bottom: 16px; }
        .pvb-step:last-child { margin-bottom: 0; }
        .pvb-step-num { width: 28px; height: 28px; border-radius: 50%; background: #485B59; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
        .pvb-step-content h4 { font-size: 14px; font-weight: 600; margin: 0 0 4px; color: #202223; }
        .pvb-step-content p { font-size: 13px; color: #6d7175; margin: 0; line-height: 1.5; }
        .pvb-tip { padding: 12px 0; border-bottom: 1px solid #e1e3e5; }
        .pvb-tip:last-child { border-bottom: none; padding-bottom: 0; }
        .pvb-tip:first-child { padding-top: 0; }
        .pvb-tip h4 { font-size: 14px; font-weight: 600; margin: 0 0 4px; color: #202223; }
        .pvb-tip p { font-size: 13px; color: #6d7175; margin: 0; line-height: 1.5; }
        .pvb-tip code { background: #f6f6f7; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
        .pvb-contact { text-align: center; padding: 24px; }
        .pvb-contact p { font-size: 14px; color: #6d7175; margin: 0; }
        .pvb-contact strong { color: #202223; }
      `}</style>

      <s-section>
        <div className="pvb-help-card">
          <h3>How It Works</h3>
          {HOW_IT_WORKS.map((step) => (
            <div key={step.step} className="pvb-step">
              <span className="pvb-step-num">{step.step}</span>
              <div className="pvb-step-content">
                <h4>{step.title}</h4>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="pvb-help-card">
          <h3>Testing Tips</h3>
          {TESTING_TIPS.map((tip, idx) => (
            <div key={idx} className="pvb-tip">
              <h4>{tip.title}</h4>
              <p>{tip.description}</p>
            </div>
          ))}
        </div>

        <div className="pvb-help-card">
          <div className="pvb-contact">
            <p>
              Questions? Contact <strong>Abbir at TOV Furniture</strong>.
            </p>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
