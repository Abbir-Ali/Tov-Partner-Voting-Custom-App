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
- Cloudflare quick tunnels sometimes time out or take ~1 minute to resolve after start: retry / wait, then reload.
- "There was an error in the third-party application" on the storefront means the app is unreachable or crashed: check the dev terminal first.
- The feature must be ON in Settings, or the API returns code `"disabled"`.

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
