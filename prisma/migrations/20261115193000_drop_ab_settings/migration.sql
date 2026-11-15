-- Drop A/B test columns from shop_settings (Task 13 dropped)
ALTER TABLE "shop_settings" DROP COLUMN "abTestEnabled";
ALTER TABLE "shop_settings" DROP COLUMN "abTestPercent";
