-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "pixelId" TEXT,
ADD COLUMN     "pixelSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "boardId" TEXT,
    "visitorHash" TEXT,
    "variant" TEXT,
    "valueCents" INTEGER,
    "currencyCode" TEXT,
    "orderId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_shop_type_createdAt_idx" ON "analytics_events"("shop", "type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_shop_boardId_idx" ON "analytics_events"("shop", "boardId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_shop_orderId_key" ON "analytics_events"("shop", "orderId");
