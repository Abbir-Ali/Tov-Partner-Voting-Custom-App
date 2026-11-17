-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN "allowHidePrices" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "shop_settings" ADD COLUMN "hidePricesDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_settings" ADD COLUMN "allowGroupLinks" BOOLEAN NOT NULL DEFAULT true;
