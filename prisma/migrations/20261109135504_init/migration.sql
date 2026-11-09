-- CreateEnum
CREATE TYPE "BoardStatus" AS ENUM ('DRAFT', 'SHARED', 'VOTED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('LOVE', 'MAYBE', 'PASS');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "customerId" TEXT,
    "ownerFirstName" TEXT,
    "ownerEmail" TEXT,
    "partnerFirstName" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "status" "BoardStatus" NOT NULL DEFAULT 'DRAFT',
    "sharedAt" TIMESTAMP(3),
    "votingCompletedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_items" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "boardItemId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "note" TEXT,
    "voterName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boards_shareToken_key" ON "boards"("shareToken");

-- CreateIndex
CREATE INDEX "boards_shop_customerId_idx" ON "boards"("shop", "customerId");

-- CreateIndex
CREATE INDEX "boards_expiresAt_idx" ON "boards"("expiresAt");

-- CreateIndex
CREATE INDEX "board_items_boardId_idx" ON "board_items"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_items_boardId_variantId_key" ON "board_items"("boardId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_boardItemId_key" ON "votes"("boardItemId");

-- AddForeignKey
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_boardItemId_fkey" FOREIGN KEY ("boardItemId") REFERENCES "board_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
