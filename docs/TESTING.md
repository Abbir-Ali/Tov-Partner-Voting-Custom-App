# Testing Reference

## Environments

- **Dev store:** abbir-official-dev-store.myshopify.com
- **Admin app:** https://admin.shopify.com/store/abbir-official-dev-store/apps/partner-voting-board/app
- **Admin settings:** https://admin.shopify.com/store/abbir-official-dev-store/apps/partner-voting-board/app/settings
- **Storefront proxy root:** https://abbir-official-dev-store.myshopify.com/apps/board
  (shows "Proxy is working" until the vote page exists)
- **API:**
  - `POST /apps/board/api/boards` — create and share a board
  - `GET /apps/board/api/boards/<shareToken>` — fetch board by token
  - `POST /apps/board/api/e` — events ingest (results page sendBeacon)
  - `POST /pixel/e` — events ingest (Web Pixel, CORS enabled)
- **Local DB:** Postgres 17, database `voting_board_dev`, user `voting_board`

## Running the app

- The developer runs `shopify app dev` in their own terminal (it's interactive; never run it yourself). Use plain `shopify app dev`, not `--use-localhost` (webhooks and app proxy need the tunnel).
- Built theme assets are committed, so no build step is needed to test. If you change theme-src/, run `npm run build:theme` and commit the result.
- Cloudflare quick tunnels sometimes time out or take ~1 minute to resolve after start: retry / wait, then reload.
- "There was an error in the third-party application" on the storefront means the app is unreachable or crashed: check the dev terminal first.
- The feature must be ON in Settings, or the API returns code `"disabled"`.

## Building theme assets

The theme JS is split for size limits (Shopify enforces <10KB per eager JS):

```
npm run build:theme
```

This bundles `theme-src/*.js` into:
- `extensions/pvb-theme/assets/pvb-button.js` — Save to Board button (core + button), <10KB
- `extensions/pvb-theme/assets/pvb-drawer.js` — Floating pill + lazy panel loader (core + pill), <10KB
- `extensions/pvb-theme/assets/pvb-panel.js` — Full drawer panel, lazy-loaded on pill click, <12KB
- `extensions/pvb-theme/assets/pvb-share.js` — Share sheet, lazy-loaded on share click, <12KB

Button and drawer are eager (loaded by schema). Panel and share are lazy (loaded on demand).
All share state via `window.__pvb`. Built assets are committed, so no build step is needed to test.

**ID normalization:** The API returns GID format (`gid://shopify/ProductVariant/123`) while
localStorage stores numeric IDs (`"123"`). The `toNumericId()` helper in core.js extracts
trailing digits for comparison. This affects `hasItem`, `removeItem`, `findVariant`, and
the ineligible items display in share.js.

## Checking the database (PowerShell)

One-line `psql -c "..."` breaks on quoted identifiers in PowerShell. Use interactive psql instead:

```
psql -U voting_board -h localhost -d voting_board_dev
```

Then run SQL at the `voting_board_dev=>` prompt, and `\q` to exit.

**Prompt guide:**
- `PS D:\...>` = PowerShell
- `voting_board_dev=>` = psql (SQL goes here)
- Browser F12 console = fetch() snippets

**Useful queries:**

```sql
select shop, enabled, "boardExpiryDays", copy from shop_settings;

select id, status, "partnerFirstName", "expiresAt"
from boards order by "createdAt" desc limit 5;
```

## Board API browser test (storefront -> F12 -> Console)

Open the storefront, press F12, and run this script in the Console:

```javascript
const EMAIL = 'YOUR_TEST_EMAIL';

// 1. Get a real variant ID from the store
const products = await fetch('/products.json').then(r => r.json());
const variant = products.products[0]?.variants[0];
if (!variant) throw new Error('No products in store');
console.log('Using variant:', variant.id, variant.title);

// 2. Create a board (expect 201)
const createRes = await fetch('/apps/board/api/boards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerFirstName: 'Test',
    partnerFirstName: 'Partner',
    ownerEmail: EMAIL,
    items: [{ variantId: String(variant.id) }]
  })
});
console.log('Create:', createRes.status, await createRes.clone().json());
// Expected: 201 with shareUrl, resultsUrl, expiresAt

// 3. Extract token and fetch the board (expect 200)
const { shareUrl } = await createRes.json();
const token = shareUrl.split('/').pop();
const fetchRes = await fetch(`/apps/board/api/boards/${token}`);
console.log('Fetch:', fetchRes.status, await fetchRes.json());
// Expected: 200 with board data including items and names

// 4. Try a fake variant (expect 400 ineligible)
const fakeRes = await fetch('/apps/board/api/boards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerFirstName: 'Test',
    partnerFirstName: 'Partner',
    ownerEmail: EMAIL,
    items: [{ variantId: '9999999999999' }]
  })
});
console.log('Fake variant:', fakeRes.status, await fakeRes.json());
// Expected: 400 with code "ineligible", reason "not_found"

// 5. Missing partner name (expect 400 invalid)
const invalidRes = await fetch('/apps/board/api/boards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerFirstName: 'Test',
    ownerEmail: EMAIL,
    items: [{ variantId: String(variant.id) }]
  })
});
console.log('Missing partner:', invalidRes.status, await invalidRes.json());
// Expected: 400 with code "invalid", fields.partnerFirstName error
```

## Expiry test

In psql, expire a board:

```sql
update boards set "expiresAt" = now() - interval '1 day'
where "shareToken" = '<token>';
```

Then GET that token in the browser. Expected: 410 with code `"expired"`.

## Daily share limit test

1. Go to Admin settings, set "Max shares per shopper per day" = 1, save.
2. Create a board (201).
3. Create another board with the same email/customer.
4. Expected: 429 with code `"limit"`.
5. Reset the limit to 10.

Note: Logged-in shoppers are counted by customer ID, guests by email.

## Expected logs

```
[board.create] shop=<shop> items=N
[board.fetch] shop=<shop> items=N
```

Never log emails, names, notes, or tokens.

## Theme App Extension Test

### Setup (one time per session)

1. **Save Settings once** to sync the metafield to the storefront:
   - Go to Admin settings: https://admin.shopify.com/store/abbir-official-dev-store/apps/partner-voting-board/app/settings
   - Set "Max pieces per board" = 2 (for the "board is full" test)
   - Ensure "Enable Partner Voting Board" is ON
   - Click Save. Toast should say "Settings saved" (not "sync failed")

2. **Enable the app embed:**
   - Go to Theme Editor: Online Store → Themes → Customize
   - Click "App embeds" (left sidebar, bottom)
   - Toggle ON "Your Board"
   - Click Save

3. **Add the app block to product template:**
   - In Theme Editor, go to a product page (use the page selector dropdown)
   - In the left sidebar, find a section that accepts blocks (e.g., "Product information")
   - Click "Add block" → Apps → "Save to Board"
   - Position it where you want the heart button
   - Click Save

### Test steps

| Step | Action | Expected |
|------|--------|----------|
| 1 | Visit a product page | Heart button "Save to Board" is visible |
| 2 | Click the heart button | Button changes to "Saved", pill appears "Your Board (1)" |
| 3 | Click the pill | Drawer slides in from right with the item (image, title, price) |
| 4 | Press Escape | Drawer closes, focus returns to pill |
| 5 | Click pill again, then click overlay | Drawer closes |
| 6 | Change variant (if product has variants) | Heart button state updates for new variant |
| 7 | Click heart on the new variant | Pill count goes to 2 |
| 8 | Try to add a third item | Message "Your board is full. Remove a piece to add another." appears |
| 9 | Open drawer, click "Remove" on one item | Item removed, count updates, heart on that product page updates |
| 10 | Click "Get a Second Opinion" button | Share sheet loads and opens |
| 11 | Tab through the drawer | Focus stays trapped inside the drawer |
| 12 | Test on mobile (responsive mode or real device) | Pill and drawer are responsive, drawer fills width on small screens |

### localStorage check (F12 Console)

```javascript
// View stored board
JSON.parse(localStorage.getItem('pvb:board:v1'))
// Expected: { items: [{ variantId, productId, handle, addedAt }, ...] }

// Clear board for fresh test
localStorage.removeItem('pvb:board:v1')
```

### Add All to Cart test

1. Save 2+ items to your board (different products)
2. Open the drawer
3. Click "Add All to Cart"
4. Expected: Button shows "Adding...", disabled during request
5. Expected: POST to /cart/add.js with qty 1 each, then redirect to /cart
6. Verify cart contains all saved variants with qty 1 each

**Duplicate prevention:** If items are already in cart, click "Add All" again.
Expected: No duplicates added, goes straight to cart page.

**Error handling:** If cart add fails (e.g., out of stock), error message
"Some pieces couldn't be added. Try again." appears below the button.

### Regression checks

| Issue | Repro steps | Expected |
|-------|-------------|----------|
| Duplicate after Remove | Save 2 items, open drawer, Remove one | Exactly 1 item remains in order, no duplicates |
| Price formatting | Save item priced $1,199.20 or similar | Price shows comma thousand separator (not "$1199.20") |
| Pill whitespace | Pill shows count | Text is "Your Board(1)" not "Your Board ( 1 )" |
| Save button styling | View Save to Board button | Full-width outline pill, min-height 44px, matches page font |
| Remove tap target | Tap Remove on mobile | Easy to tap (44×44px minimum) |
| Pill position | Check pill on desktop | 72px from bottom by default |

### Reset after testing

- Set "Max pieces per board" back to 10 in Settings


## Share Sheet Test (Task 7)

### Prerequisites

1. `npm run build:theme` has been run and bundles pass (all < 11KB)
2. Feature enabled in Admin settings
3. App embed and block enabled in theme
4. `shopify app dev` running with tunnel

### Test steps

| Step | Action | Expected |
|------|--------|----------|
| 1 | Save 1-2 items to your board | Items saved, pill shows count |
| 2 | Open the drawer, click "Get a Second Opinion" | Share sheet loads (may take a moment first time), slides up on mobile, centers on desktop |
| 3 | Try to submit with empty fields | "Enter their name" and "Enter your name" errors appear under fields |
| 4 | Enter "Partner" in "Their first name" | Submit button changes to "Send to Partner" |
| 5 | Enter invalid email "abc" | "Enter a valid email" error appears |
| 6 | Fill all required fields, add a note | Note counter updates (e.g., "45/280") |
| 7 | Click "Send to Partner" | Button shows "Sending...", disabled, loading spinner |
| 8 | Wait for API response | Success: Native share dialog (mobile) or channel buttons appear |
| 9 | If channels visible: click WhatsApp | Opens WhatsApp with pre-filled message "{Your name} wants your vote on {N} pieces from {shop}." |
| 10 | Click "Copy" | Button text changes to "Copied", URL is in clipboard |
| 11 | Click "Done" or outside overlay | Share sheet closes |
| 12 | Check drawer footer | "Shared with {Partner}" row appears with checkmark |
| 13 | Press Escape while sheet is open | Sheet closes, focus returns |
| 14 | Tab through share sheet | Focus trapped inside dialog |

### Error handling test

1. With feature disabled in Settings, click "Get a Second Opinion"
2. Expected: "Sharing is turned off right now." error message

3. After hitting daily limit (set limit=1, share twice):
4. Expected: Server message (e.g., "Too many shares today.") displayed

5. Add a product with the excludeTag to your board, then try to share:
6. Expected: "Some pieces can't be shared right now:" list with product title, reason "Not available for sharing", and Remove button

7. Test with invalid variant (product removed after saving):
8. Expected: Ineligible item shows "No longer available"

### localStorage check (F12 Console)

```javascript
// Check saved owner name (NOT email)
localStorage.getItem('pvb:owner:v1')
// Expected: "YourFirstName" (only name, never email)

// Check share history (readable keys since Task 7)
JSON.parse(localStorage.getItem('pvb:shares:v1'))
// Expected: [{ partnerFirstName: "Partner", resultsUrl: "https://...", count: 2, sharedAt: 1234567890 }, ...]
// Max 10 entries, most recent first

// Clear for fresh test
localStorage.removeItem('pvb:owner:v1')
localStorage.removeItem('pvb:shares:v1')
```

### Share message format

The share message should be:
```
{Your name} wants your vote on {N} pieces from {Shop name}.
```

If a note was added:
```
{Your name} wants your vote on {N} pieces from {Shop name}. "{Note text}"
```

### Customer prefill test

1. Log in as a customer on the storefront
2. Open share sheet
3. Expected: "Your first name" and "Your email" prefilled from account
4. Expected: Email field is optional (not required) when logged in

### Mobile-specific tests

| Test | Action | Expected |
|------|--------|----------|
| Bottom sheet | Open share sheet on mobile | Sheet slides up from bottom with grab handle |
| Scroll | Add long note, scroll form | Form scrolls inside fixed sheet |
| Native share | Complete form on iOS/Android | Native share picker appears first |
| Keyboard | Focus email field | Virtual keyboard doesn't break layout |


### Exclude tag test

1. In Admin settings, set "Exclude tag" to `no-board` and save
2. Add tag `no-board` to a test product in Shopify admin
3. Visit that product page
4. Expected: "Save to Board" button is NOT rendered (block hidden)
5. Gift card products should also not show the button (automatic)

**Metafield check (F12 on storefront):**
```javascript
// The config metafield now includes excludeTag
// View in Network tab: look for any Liquid request, check app.metafields.pvb.config
```



## Vote Page Test (Task 8)

### Prerequisites

1. `npm run build:vote` has been run (vote-page assets built)
2. Bundle limit: 24 KB combined (JS + CSS). Raised from 15 KB in Task 8 for the swipe deck, welcome and recap screens.
3. Feature enabled in Admin settings
4. A shared board exists (create via share sheet or API test above)
5. `shopify app dev` running with tunnel

### URLs

- **Vote page:** `https://<store>.myshopify.com/apps/board/<shareToken>`
- **Results page:** `https://<store>.myshopify.com/apps/board/results/<ownerToken>`
  - State A (VOTED): Shows loved/maybe/pass sections with cart handoff
  - State B (SHARED): Shows voting progress with copy link button
- **Vote API:** `POST /apps/board/api/boards/<shareToken>/votes`

### Test steps (logged out, incognito recommended)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open share link in new incognito window | Vote page loads with items, progress bar, brand styling |
| 2 | Check page header | Shop name (uppercase), eyebrow "{Owner}'s {Board name}", headline from settings |
| 3 | Check card | Item image (or placeholder), title, price, "View Details" link, "Sold out" chip if applicable |
| 4 | Click "View Details" | Opens product page in new tab |
| 5 | Click Love button (heart icon) | Stamp appears "Love It" (Forest color), card animates right, next card loads |
| 6 | Click Pass button (X icon) | Stamp appears "Not For Us" (Bold Lip color), card animates left |
| 7 | Click Maybe button (? icon) | Stamp appears "Maybe" (Truffle color), card animates up |
| 8 | Click "Back" button | Previous item reappears, can re-vote |
| 9 | Use keyboard: ArrowRight | Same as Love |
| 10 | Use keyboard: ArrowLeft | Same as Pass |
| 11 | Use keyboard: ArrowUp | Same as Maybe |
| 12 | Use keyboard: ArrowDown or Backspace | Same as Back |
| 13 | Complete all votes | Done screen appears with heart, "Thanks, {Partner}." headline, loved count, thumbnails |
| 14 | Click "Shop {Shop}" button | Goes to store homepage |

### Swipe test (touch device or mobile emulation)

| Action | Expected |
|--------|----------|
| Swipe right | Love vote |
| Swipe left | Pass vote |
| Swipe up | Maybe vote |

Threshold: ~80px of movement required to register a vote.

### Resume test

1. Vote on 1-2 items
2. Refresh the page
3. Expected: Resume at first unvoted item, previous votes preserved

### localStorage check (F12 Console)

```javascript
// View vote progress (key is sha-256 hash of token, first 16 hex)
// Find key:
Object.keys(localStorage).filter(k => k.startsWith('pvb:vote:v1:'))
// View:
JSON.parse(localStorage.getItem('pvb:vote:v1:<hash>'))
// Expected: { votes: { "<itemId>": "LOVE", ... } }
```

### Lock after completion

1. Complete all votes on a board
2. Refresh the page
3. Expected: Done screen still shows (board is VOTED)
4. Try to vote via API (should fail):

```javascript
// In F12 console:
const res = await fetch('/apps/board/api/boards/<token>/votes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ itemId: '<any-item-id>', verdict: 'LOVE' })
});
console.log(res.status, await res.json());
// Expected: 409 { error: { code: "locked" } }
```

### Expired link test

In psql:
```sql
update boards set "expiresAt" = now() - interval '1 day'
where "shareToken" = '<token>';
```

Then refresh vote page. Expected: "This board has closed" message with "Shop {Shop}" button.

### Results placeholder test

1. Open the results URL (with owner token, not share token)
2. Expected: "Results are on the way" message, "{Partner} finishes voting" text, "Shop {Shop}" button

### Not found test

1. Visit `/apps/board/invalid-token-123`
2. Expected: "This link doesn't work" page

3. Visit `/apps/board/results/invalid-owner-token`
4. Expected: "This link doesn't work" page

5. Visit `/apps/board/` (root)
6. Expected: "This link doesn't work" page

### WhatsApp preview test

1. Share a vote link via WhatsApp (or paste into a chat)
2. Expected: Link preview shows "{Owner} wants your vote" title, "{N} pieces from {Shop}. It only takes a minute." description, first item image

### Reduced motion test

1. Enable "Reduce motion" in OS settings
2. Vote on items
3. Expected: No card animations, instant transitions

### Database verification (psql)

After voting:
```sql
-- Check votes were recorded
select v.id, v.verdict, v."voterName", v."createdAt"
from votes v
join board_items bi on v."boardItemId" = bi.id
join boards b on bi."boardId" = b.id
where b."shareToken" = '<token>';

-- Check board status after completion
select status, "votingCompletedAt", "partnerOpenedAt"
from boards where "shareToken" = '<token>';
-- Expected: status = 'VOTED', votingCompletedAt set, partnerOpenedAt set

-- Check rate limit counter
select "voteWrites", "voteWindowStart"
from boards where "shareToken" = '<token>';
```

### Error handling

| Scenario | Expected |
|----------|----------|
| Network error during vote | Toast "Connection error. Please try again." vote not recorded |
| Server error | Toast "Something went wrong. Please try again." |
| Rate limited (429) | Toast "Too many votes. Try again in a minute." |
| Board locked elsewhere | Redirect to done screen |

### Escaping test (security)

Create a board with malicious note via API:

```javascript
const res = await fetch('/apps/board/api/boards', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ownerFirstName: 'Test',
    partnerFirstName: 'Partner',
    ownerEmail: 'test@example.com',
    note: '{% endraw %}{{ shop.email }}<script>alert(1)</script>',
    items: [{ variantId: '<valid-variant-id>' }]
  })
});
const { shareUrl } = await res.json();
console.log('Vote page:', shareUrl);
```

Open the vote page. Expected: The note displays as plain text, no alert, no Liquid injection.


## App Log

In development, the app writes JSON lines to `logs/app.log`. View them with:

```bash
npm run log          # last 30 lines
npm run log -- 100   # last 100 lines
npm run log -- vote  # lines containing "vote"
```

Sample output:
```
20:11:05  INFO   webhook.app_uninstalled      shop=abbir-official-dev-store.myshopify.com
20:11:06  INFO   storefront_sync.ok           shop=abbir-official-dev-store.myshopify.com
20:11:07  INFO   board.created                shop=abbir-official-dev-store.myshopify.com items=2
```

Events:
- `webhook.app_uninstalled`, `webhook.scopes_update` — webhooks received
- `auth.after_auth` — successful auth (before sync)
- `auth.after_auth_sync_failed` — sync failed during auth
- `storefront_sync.ok`, `storefront_sync.failed` — metafield sync
- `settings.saved` — admin saved settings
- `board.created`, `board.create_upstream`, `board.create_rejected`, `board.fetch` — board API
- `vote.saved`, `vote.completed`, `vote.rejected` — vote API
- `proxy.vote_page`, `proxy.results_page` — page served (status = SHARED/VOTED/expired/not_found/disabled)
- `proxy.vote_page_variants` — vote page variant fetch error

Never logged: emails, names, notes, tokens, request bodies.



## Klaviyo Notification Test (Task 10)

### Prerequisites

1. APP_ENCRYPTION_KEY set in .env (generate with command in .env.example)
2. Klaviyo account with a private API key (Events: Write, Accounts: Read scopes)
3. Feature enabled in Admin settings
4. `shopify app dev` running

### Setup

1. Generate APP_ENCRYPTION_KEY if missing:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Add to .env: `APP_ENCRYPTION_KEY="<output>"`

2. Create a Klaviyo private key with scopes: Events: Write, Accounts: Read

### Test steps

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open Settings without APP_ENCRYPTION_KEY | "Encryption key missing" banner, Klaviyo field disabled |
| 2 | Add APP_ENCRYPTION_KEY, restart dev server | Banner gone, Klaviyo field enabled |
| 3 | Enter invalid key "pk_abc123", save | "Klaviyo didn't accept this key" error |
| 4 | Enter valid key, save | "Settings saved" toast, "Connected · key ending in XXXX" appears |
| 5 | Enter email in test field, click "Send Test Event" | "Test event sent to Klaviyo" toast |
| 6 | Check Klaviyo Analytics → Metrics | "PVB Voting Completed" metric with test event |
| 7 | Click "Remove key" | "Klaviyo key removed" toast, key field reappears |

### End-to-end notification test

1. Connect Klaviyo key in Settings
2. Create and share a board with your email
3. Open the vote link, vote on all items
4. Check Klaviyo Analytics → Metrics → PVB Voting Completed
5. Expected: Event with your email, vote counts, results_url

### Database check (psql)

```sql
-- Check notification status after voting
select id, status, "notifiedAt", "notifyAttempts", "notifyErrorCode"
from boards order by "createdAt" desc limit 5;

-- Check Klaviyo connection
select shop, "klaviyoKeyLast4", "klaviyoConnectedAt"
from shop_settings;
```

### Admin banners test

| Condition | Banner |
|-----------|--------|
| Notifications on, no Klaviyo key | Info: "Connect Klaviyo in Settings..." |
| Board with notifyAttempts >= 3 | Warning: "Some emails couldn't be sent..." |

### App log events

```
klaviyo.key_saved    shop=...
klaviyo.key_invalid  shop=...
klaviyo.test_sent    shop=... ok=true
notify.sent          shop=... boardId=...
notify.skipped       shop=... boardId=... reason=no_key
notify.failed        shop=... boardId=... code=401 attempt=1
```
