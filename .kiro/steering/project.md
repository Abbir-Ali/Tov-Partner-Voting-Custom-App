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

## Phase 1 (MVP) scope

Share a board, vote page, "voting done" email, cart hand-off. NOT in Phase 1:

PDP/cart entry points, SMS, "Start your own board", multiple voters,

B2B portal version.

## How we work (important)

- Work is split into numbered tasks given to you one at a time. Do ONLY the

  current task. Don't build ahead, don't refactor unrelated code.

- Before changing files, say which files you'll touch and why.

- No new npm packages unless the task says so; ask first.

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

## Brand (for any storefront UI or email)

Colors: Cream #FEFBF6, Soft Taupe #F1ECE5, Blush #F9D2D2, Truffle #82736C,

Not-Black #3F3D3E (never pure black), Forest #485B59, Bold Lip #A40713

(sale/urgent only). Headings: GT Ultra Fine regular. Body/buttons: Montserrat.

Buttons: pill, uppercase bold, +4.5% letter-spacing. Voice: warm, plain,

second person, Title Case CTAs, no emoji, no exclamation hype.

No gradients, neon, or purple.
