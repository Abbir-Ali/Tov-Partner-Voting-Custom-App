-- AlterTable
ALTER TABLE "boards" ADD COLUMN     "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notifyErrorCode" TEXT;

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "klaviyoConnectedAt" TIMESTAMP(3),
ADD COLUMN     "klaviyoKeyEncrypted" TEXT,
ADD COLUMN     "klaviyoKeyLast4" TEXT;
