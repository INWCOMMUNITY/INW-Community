-- CreateTable
CREATE TABLE "listing_feed_collection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_feed_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_feed_collection_item" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_feed_collection_item_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "source_listing_collection_id" TEXT;

-- CreateIndex
CREATE INDEX "listing_feed_collection_member_id_idx" ON "listing_feed_collection"("member_id");

-- CreateIndex
CREATE INDEX "listing_feed_collection_item_store_item_id_idx" ON "listing_feed_collection_item"("store_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_feed_collection_item_collection_id_store_item_id_key" ON "listing_feed_collection_item"("collection_id", "store_item_id");

-- CreateIndex
CREATE INDEX "Post_source_listing_collection_id_idx" ON "Post"("source_listing_collection_id");

-- AddForeignKey
ALTER TABLE "listing_feed_collection" ADD CONSTRAINT "listing_feed_collection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_feed_collection_item" ADD CONSTRAINT "listing_feed_collection_item_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "listing_feed_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_feed_collection_item" ADD CONSTRAINT "listing_feed_collection_item_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_source_listing_collection_id_fkey" FOREIGN KEY ("source_listing_collection_id") REFERENCES "listing_feed_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
