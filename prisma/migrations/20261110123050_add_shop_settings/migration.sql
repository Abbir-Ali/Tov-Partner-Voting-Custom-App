-- CreateTable
CREATE TABLE "shop_settings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "abTestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "abTestPercent" INTEGER NOT NULL DEFAULT 50,
    "boardExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "maxItemsPerBoard" INTEGER NOT NULL DEFAULT 12,
    "maxSharesPerDay" INTEGER NOT NULL DEFAULT 10,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "excludeTag" TEXT NOT NULL DEFAULT 'pvb-exclude',
    "copy" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_settings_shop_key" ON "shop_settings"("shop");
