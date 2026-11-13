---

inclusion: always

---

# TOV Partner Voting Board

## What it is

A storefront feature for TOV Furniture (tovfurniture.com, Shopify).

A SHOPPER saves furniture pieces to a board and shares a private link with

their partner (spouse, roommate, friend). The PARTNER opens the link on the

storefront with NO account and votes Love / Maybe / Pass on each piece.

When voting is done the shopper gets an email ("Alex loved 3 of 5. Your cart

is ready.") and one tap opens a cart pre-filled with the loved pieces.

This is NOT an admin voting tool and NOT about Shopify Partners.

## Who uses what

- Shopper: storefront (theme). Logged in or guest.

- Partner (voter): storefront vote page via Shopify App Proxy, no login.

- Store admin: minimal embedded admin UI (settings/basic stats), later.

## Architecture

- Theme (Liquid + JS): save-to-board heart, board view, share sheet.

  Built separately; not in this repo unless a theme app extension is added.

- This app: Shopify React Router template (JavaScript flavor: .js/.jsx), Prisma, Postgres

  (currently SQLite from the template; switching to Postgres in Task 2).

- Vote page: served on the storefront through an App Proxy at /apps/board/...

- Notifications: Klaviyo custom event (preferred) or Shopify Flow. Later task.

- Cart: hand-off of loved variant IDs to the Shopify cart. Later task.

- Admin UI: Polaris web components (<s-page>, <s-button>…), as in the template.

## Data model (starting point, will be refined in Task 2)

- boards: id, share_token (unguessable), customer_id (nullable for guests),

  name, note, created_at, expires_at

- board_items: id, board_id, product_id, variant_id, position

- votes: id, board_item_id, verdict (love | maybe | pass), note,

  voter_name, created_at

## Privacy rules

- Share tokens are unguessable; boards expire.

- The partner never needs an account and is not tracked beyond the vote.

- Only first names are shown to the other person. No personal data in URLs.

## Phase 1 scope (updated)

Share a board, vote page, "voting done" email, cart hand-off, PLUS:

- Admin Settings page: on/off, A/B split, expiry, limits, exclusions,

  vote page copy. Day-to-day changes must not need code.

- Storefront UI as a theme app extension (app embed + app blocks) so the

  team configures labels/colors/placement in the theme editor.

- Tracking: Web Pixel extension + events endpoint + orders webhook with

  cart-attribute attribution. Admin dashboard: impressions, clicks,

  shares, partner opens, votes completed, cart opens, checkouts, orders,

  revenue, AOV, A/B comparison.

Decisions: boards expire 30 days after sharing (configurable). Guests can

save; the board is created on the server only when shared.

NOT in Phase 1: SMS, "Start your own board", multiple voters, B2B.

## How we work (important)

- Work is split into numbered tasks given to you one at a time. Do ONLY the

  current task. Don't build ahead, don't refactor unrelated code.

- Before changing files, say which files you'll touch and why.

- No new npm packages unless the task says so; ask first.

- Never install skills, packages or tools without asking me first.

- Follow the template's existing patterns (routes in app/routes, auth via

  app/shopify.server.js, Prisma via app/db.server.js).

- Never commit .env, secrets, or database files.

- After each task: show the diff summary, run `npm run lint`, and

  commit with a clear message. Don't push unless asked.

- Explain React/React Router patterns briefly when you use them; the

  developer is still strengthening React fundamentals.

- If something depends on an assumption (store plan, theme, Klaviyo),

  state it instead of guessing.

- If a change outside the current task seems needed, stop and ask first.

  Never bundle unrelated changes into a task's commit.

- Client-side code (route components) must never import from *.server.js.

  Shared constants go in *.shared.js.

- theme-src/ is the readable source. Never hand-minify; esbuild does that.

  After any change there, run npm run build:theme and commit the built

  assets in the same commit. Never edit extensions/pvb-theme/assets/*.js

  by hand. On-page theme bundles ≤ 10,000 B, lazy bundles ≤ 15,000 B.

  Never change a limit without asking.

- app/vote-page/ is the readable source for the vote page. After any change

  there, run npm run build:vote and commit the built module. Limit 20 KB.

- Lint passing isn't enough: after any app change, check the

  `shopify app dev` terminal for Vite/build errors before asking me to test.

- Testing reference: docs/TESTING.md. Update it whenever a task adds

  URLs, endpoints, test scripts or checks. Browser test steps must be

  specific: exact URLs, scripts and expected results.

- When Abbir asks what happened, run npm run log and summarise it in plain words.

## Brand (for any storefront UI or email)

Colors: Cream #FEFBF6, Soft Taupe #F1ECE5, Blush #F9D2D2, Truffle #82736C,

Not-Black #3F3D3E (never pure black), Forest #485B59, Bold Lip #A40713

(sale/urgent only). Headings: GT Ultra Fine regular. Body/buttons: Montserrat.

Buttons: pill, uppercase bold, +4.5% letter-spacing. Voice: warm, plain,

second person, Title Case CTAs, no emoji, no exclamation hype.

No gradients, neon, or purple.


## Handoff

- When Abbir says "run the handoff", read .kiro/handoff/prompt.md and do exactly that task.
- When you STOP, write your full report to .kiro/handoff/report.md (overwrite it): what changed, files, build sizes, reviewer result, test steps, and anything you could not do. Start it with the date and time and the first line of the prompt.
- Never commit anything under .kiro/handoff/ (it is in .gitignore).
