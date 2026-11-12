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

The theme JS is split for size limits (Shopify enforces <10KB per JS file):

```
npm run build:theme
```

This bundles `theme-src/*.js` into:
- `extensions/pvb-theme/assets/pvb-button.js` — Save to Board button (core + button)
- `extensions/pvb-theme/assets/pvb-drawer.js` — Board drawer + pill (core + drawer)

Both share state via `window.__pvb`. Built assets are committed, so no build step is needed to test.

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
| 10 | Click "Get a Second Opinion" button | Button is disabled, helper text "Sharing is coming soon." visible |
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

