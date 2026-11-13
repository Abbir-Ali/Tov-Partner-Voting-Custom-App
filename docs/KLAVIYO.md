# Klaviyo Integration

Partner Voting Board sends a "voting done" event to Klaviyo when a partner finishes voting. You build the email (or SMS) in Klaviyo using a metric-triggered flow. The app never sends email itself.

## Setup

### 1. Create a Klaviyo Private API Key

1. In Klaviyo, go to Settings → API Keys.
2. Click "Create Private API Key".
3. Name it something like "Partner Voting Board".
4. Under Scopes, enable:
   - **Accounts: Read** (for key validation)
   - **Events: Full Access** (to send the voting-done event)
   - **Profiles: Full Access** (so Klaviyo can create the shopper's profile)
5. Copy the key (you won't see it again).

### 2. Add the Key in Settings

1. In the Shopify admin, open the Partner Voting Board app.
2. Go to Settings → Notifications.
3. Paste the key in "Klaviyo private API key" and save.
4. You should see "Connected · key ending in XXXX".

### 3. Create the Flow in Klaviyo

1. Go to Flows → Create Flow → Create from scratch.
2. Choose trigger: **Metric** → select **PVB Voting Completed**.
3. Add an Email action.
4. Design the email using the event properties below.

## Event: PVB Voting Completed

Sent once when the partner submits their final vote.

### Profile

| Field | Description |
|-------|-------------|
| `email` | The shopper's email address |
| `first_name` | The shopper's first name |

### Event Properties

| Property | Type | Example |
|----------|------|---------|
| `owner_first_name` | string | `"Sarah"` |
| `partner_first_name` | string | `"Alex"` |
| `loved_count` | number | `3` |
| `maybe_count` | number | `1` |
| `pass_count` | number | `1` |
| `total` | number | `5` |
| `results_url` | string | `"https://store.myshopify.com/apps/board/results/abc123"` |
| `board_name` | string | `"Living Room Ideas"` |
| `loved_items` | array | See below |

### loved_items Array (max 6)

Each item in the array:

| Field | Example |
|-------|---------|
| `title` | `"Velvet Sofa"` |
| `variant_title` | `"Gray / Large"` |
| `price` | `"$1,299.00"` |
| `image_url` | `"https://cdn.shopify.com/..."` |
| `product_url` | `"https://store.com/products/velvet-sofa"` |

## Tested Email (Klaviyo Flow)

### Flow Setup

| Setting | Value |
|---------|-------|
| Name | Partner Voting Board – Voting Done |
| Trigger | Metric: **PVB Voting Completed** |
| Re-entry | Allow re-entry |
| Filters | None |
| Delay | None |

### Email Settings

| Setting | Value |
|---------|-------|
| Subject | `{{ event.partner_first_name }} voted on your board` |
| Preview text | `Loved {{ event.loved_count }} of {{ event.total }}. Your cart is ready.` |
| Smart Sending | **OFF** (this email is the answer the shopper is waiting for) |
| UTM tracking | ON |

### Content

1. Start with a blank template.
2. Add your store logo at the top.
3. Add one HTML block with the contents of `docs/klaviyo/voting-done-email.html`.
4. Keep Klaviyo's default footer (unsubscribe link + organization address are required).

### Notes

- The template hides `variant_title` when it equals "Default Title" (single-variant products).
- Georgia is the email-safe stand-in for GT Ultra Fine (the brand heading font).

## Test Event

Use the "Send Test Event" button in Settings to send a sample event with:
- Partner: Alex
- Loved: 2 of 4
- Sample furniture items

This lets you preview the email in Klaviyo before going live.

## Retry Logic

If Klaviyo is unreachable, the app retries up to 3 times over 7 days. After 3 failures, a warning appears on the admin Home page.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Klaviyo didn't accept this key" | Check the key has Accounts: Read, Events: Full Access, and Profiles: Full Access scopes |
| "Encryption key missing" banner | Add APP_ENCRYPTION_KEY to .env (see .env.example) |
| Events not appearing in Klaviyo | Check the metric name is exactly "PVB Voting Completed" |
| Email not sending | Confirm the flow is Live and the trigger matches the metric |
