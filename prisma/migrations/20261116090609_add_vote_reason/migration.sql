-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "askReasons" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "votes" ADD COLUMN     "reason" TEXT;
