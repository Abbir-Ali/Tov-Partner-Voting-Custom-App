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

