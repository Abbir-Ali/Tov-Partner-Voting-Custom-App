-- Indexes for Boards list page filtering and sorting
-- shop + sharedAt for date range filtering and default sort
CREATE INDEX "boards_shop_sharedAt_idx" ON "boards"("shop", "sharedAt" DESC);

-- shop + status for status filtering
CREATE INDEX "boards_shop_status_idx" ON "boards"("shop", "status");

-- board_items productId for product filtering
CREATE INDEX "board_items_productId_idx" ON "board_items"("productId");
