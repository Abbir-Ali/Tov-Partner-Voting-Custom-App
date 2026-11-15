-- AlterTable
ALTER TABLE "analytics_events" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "buyerTag" TEXT NOT NULL DEFAULT 'pvb-board-buyer';

-- CreateIndex
CREATE INDEX "analytics_events_shop_customerId_idx" ON "analytics_events"("shop", "customerId");
