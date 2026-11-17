# Partner Voting Board Tools

## What This App Does

Partner Voting Board lets shoppers save furniture pieces to a board, share a link with their partner (spouse, roommate, friend), and the partner votes Loved / Maybe / Not For Us on each piece. When voting is done, the shopper gets an email and can add the loved pieces to cart. Boards can have multiple voters (up to 5).

## When to Use These Tools

- **board_performance**: Ask about board revenue, orders, AOV, vote rate (people who finished / people invited), funnel metrics
- **top_shared_products**: Ask which products people share most or ask a second opinion on
- **product_partner_feedback**: Ask what voters think of a specific product (counts every voter's vote)
- **orders_from_boards**: Ask about recent orders from boards
- **shares_by_channel**: Ask which channels (WhatsApp, Email, etc.) shoppers use to share
- **notification_health**: Ask if voting-done emails are working
- **top_board_customers**: Only when the merchant asks about their customers (top customers, repeat buyers, who ordered from boards)
- **partner_reasons**: Ask why voters chose Maybe or Pass
- **group_voting_stats**: Ask about group voting patterns (boards by voter count, avg voters per board, vote rate by group size, % prices hidden, % group links)

## Important Notes

- Numbers come from the app's own tracking, not Shopify analytics
- **Vote rate** = voters who finished voting / voters invited. A board with 3 voters where 2 finished = 2/3.
- **Opened** = boards where at least one voter opened the link
- **Voted** = boards where at least one voter finished voting
- **Funnel tracking caveat:** "Button seen" and "Saved" come from storefront tracking (only visitors who accepted analytics cookies, and only since tracking was enabled). "Shared", "Opened", and "Voted" come from every board. Early funnel numbers may be lower than later steps because of this.
- Products need 5+ votes before feedback is meaningful
- Channels need 5+ boards before vote rate is meaningful
- Staff can open the Boards page in the app for customer-level details

## Privacy Rules

- **top_board_customers** returns customer names, board order counts, and revenue only when the merchant explicitly asks about customers
- Customer emails, phone numbers, addresses, and notes are never returned
- Voter names (first names only) and shopper first names from the share form are never returned by tools
- Other tools do not include any customer information

## Examples

- "How are partner boards doing this month?" → board_performance
- "Which products do people ask a second opinion on most?" → top_shared_products
- "What do voters think of the Tristine sofa?" → product_partner_feedback
- "Show orders from shared boards" → orders_from_boards
- "Are the voting-done emails working?" → notification_health
- "Who are my top board customers?" → top_board_customers
- "Which customers are repeat board buyers?" → top_board_customers with repeat_only=true
- "How are group boards doing?" → group_voting_stats
- "What percent of boards have multiple voters?" → group_voting_stats
