-- AlterTable
ALTER TABLE "boards" ADD COLUMN     "partnerOpenedAt" TIMESTAMP(3),
ADD COLUMN     "voteWindowStart" TIMESTAMP(3),
ADD COLUMN     "voteWrites" INTEGER NOT NULL DEFAULT 0;
