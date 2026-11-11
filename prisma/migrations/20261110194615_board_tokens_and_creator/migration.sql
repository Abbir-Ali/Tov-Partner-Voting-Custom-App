-- AlterTable: add ownerToken and creatorKey to boards.
-- Temporary defaults are removed below; assumes table is empty or a backfill
-- script runs for existing rows before this migration.
ALTER TABLE "boards" ADD COLUMN "ownerToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "boards" ADD COLUMN "creatorKey" TEXT NOT NULL DEFAULT '';

-- Remove the temporary defaults (columns are truly NOT NULL from here on)
ALTER TABLE "boards" ALTER COLUMN "ownerToken" DROP DEFAULT;
ALTER TABLE "boards" ALTER COLUMN "creatorKey" DROP DEFAULT;

-- CreateIndex: unique token per board owner
CREATE UNIQUE INDEX "boards_ownerToken_key" ON "boards"("ownerToken");

-- CreateIndex: for daily-share-count queries
CREATE INDEX "boards_shop_creatorKey_createdAt_idx" ON "boards"("shop", "creatorKey", "createdAt");
