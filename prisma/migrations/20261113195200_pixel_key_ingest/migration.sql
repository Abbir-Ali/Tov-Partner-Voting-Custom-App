-- Add pixelKey and pixelIngestUrl columns to ShopSettings
ALTER TABLE "shop_settings" ADD COLUMN "pixelKey" TEXT;
ALTER TABLE "shop_settings" ADD COLUMN "pixelIngestUrl" TEXT;
