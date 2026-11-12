-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "storefrontSyncedAt" TIMESTAMP(3),
ADD COLUMN     "storefrontSyncedVersion" INTEGER;
