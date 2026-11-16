/**
 * Partner Voting Board Sidekick tools.
 * PRIVACY RULE: Customer names, board order counts and revenue only via
 * top_board_customers, only when the merchant asks. Never emails, phones,
 * addresses, notes or partner names.
 */

export default () => {
  shopify.tools.register('board_performance', async ({ days = 30 }) => {
    try {
      const res = await fetch(`/api/sidekick/board_performance?days=${days}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('top_shared_products', async ({ days = 30, limit = 10 }) => {
    try {
      const res = await fetch(`/api/sidekick/top_shared_products?days=${days}&limit=${limit}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('product_partner_feedback', async ({ product_title, product_id }) => {
    try {
      const params = new URLSearchParams();
      if (product_title) params.set('product_title', product_title);
      if (product_id) params.set('product_id', product_id);
      const res = await fetch(`/api/sidekick/product_partner_feedback?${params}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('orders_from_boards', async ({ days = 30, limit = 10 }) => {
    try {
      const res = await fetch(`/api/sidekick/orders_from_boards?days=${days}&limit=${limit}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('shares_by_channel', async ({ days = 30 }) => {
    try {
      const res = await fetch(`/api/sidekick/shares_by_channel?days=${days}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('notification_health', async () => {
    try {
      const res = await fetch('/api/sidekick/notification_health');
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('top_board_customers', async ({ days = 30, limit = 10, repeat_only = false }) => {
    try {
      const params = new URLSearchParams();
      params.set('days', days);
      params.set('limit', limit);
      if (repeat_only) params.set('repeat_only', 'true');
      const res = await fetch(`/api/sidekick/top_board_customers?${params}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });

  shopify.tools.register('partner_reasons', async ({ days = 30 }) => {
    try {
      const res = await fetch(`/api/sidekick/partner_reasons?days=${days}`);
      return res.json();
    } catch {
      return { error: 'unavailable' };
    }
  });
};
