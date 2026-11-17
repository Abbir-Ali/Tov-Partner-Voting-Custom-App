-- CreateEnum
CREATE TYPE "VoterKind" AS ENUM ('PERSONAL', 'GROUP');

-- CreateTable
CREATE TABLE "voters" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "kind" "VoterKind" NOT NULL DEFAULT 'PERSONAL',
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "notifyErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voters_token_key" ON "voters"("token");

-- CreateIndex
CREATE INDEX "voters_boardId_idx" ON "voters"("boardId");

-- AddForeignKey
ALTER TABLE "voters" ADD CONSTRAINT "voters_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add new columns to boards
ALTER TABLE "boards" ADD COLUMN "hidePrices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "boards" ADD COLUMN "groupToken" TEXT;
ALTER TABLE "boards" ADD COLUMN "maxVoters" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "boards_groupToken_key" ON "boards"("groupToken");

-- AlterTable: add voterId column (nullable first for backfill)
ALTER TABLE "votes" ADD COLUMN "voterId" TEXT;

-- Backfill: create a PERSONAL Voter for every board that has partnerFirstName or votes
INSERT INTO "voters" ("id", "boardId", "token", "firstName", "kind", "openedAt", "completedAt", "notifiedAt", "notifyAttempts", "createdAt")
SELECT
    gen_random_uuid()::text,
    b."id",
    b."shareToken",
    COALESCE(b."partnerFirstName", 'Partner'),
    'PERSONAL'::"VoterKind",
    b."partnerOpenedAt",
    b."votingCompletedAt",
    b."notifiedAt",
    b."notifyAttempts",
    CURRENT_TIMESTAMP
FROM "boards" b
WHERE b."partnerFirstName" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "votes" v JOIN "board_items" bi ON v."boardItemId" = bi."id" WHERE bi."boardId" = b."id");

-- Update votes with the voterId from their board's voter
UPDATE "votes" v
SET "voterId" = voter."id"
FROM "board_items" bi, "voters" voter
WHERE v."boardItemId" = bi."id"
  AND voter."boardId" = bi."boardId"
  AND voter."kind" = 'PERSONAL';

-- Drop the old unique constraint on votes (one vote per item)
ALTER TABLE "votes" DROP CONSTRAINT IF EXISTS "votes_boardItemId_key";

-- Make voterId NOT NULL now that backfill is done
ALTER TABLE "votes" ALTER COLUMN "voterId" SET NOT NULL;

-- AddForeignKey for voterId
ALTER TABLE "votes" ADD CONSTRAINT "votes_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "voters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: new unique constraint (one vote per item per voter)
CREATE UNIQUE INDEX "votes_boardItemId_voterId_key" ON "votes"("boardItemId", "voterId");

-- CreateIndex: index for looking up votes by voter
CREATE INDEX "votes_voterId_idx" ON "votes"("voterId");
