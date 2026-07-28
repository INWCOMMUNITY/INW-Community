-- CreateTable
CREATE TABLE "member_listing_view" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "session_id" TEXT,
    "store_item_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_listing_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_listing_view_store_item_id_created_at_idx" ON "member_listing_view"("store_item_id", "created_at");

-- CreateIndex
CREATE INDEX "member_listing_view_viewer_id_created_at_idx" ON "member_listing_view"("viewer_id", "created_at");

-- AddForeignKey
ALTER TABLE "member_listing_view" ADD CONSTRAINT "member_listing_view_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_listing_view" ADD CONSTRAINT "member_listing_view_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
