-- Add low stock threshold to store items
ALTER TABLE "StoreItem" ADD COLUMN "low_stock_threshold" INTEGER;

-- Add seller ops notification preference
ALTER TABLE "member_notification_preferences" ADD COLUMN "notify_seller_ops" BOOLEAN NOT NULL DEFAULT true;

-- Seller analytics events table
CREATE TABLE "seller_analytics_event" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT,
    "event_type" TEXT NOT NULL,
    "provider" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_analytics_event_pkey" PRIMARY KEY ("id")
);

-- Seller activity log table
CREATE TABLE "seller_activity_log" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "detail" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_activity_log_pkey" PRIMARY KEY ("id")
);

-- Bulk edit snapshot table
CREATE TABLE "bulk_edit_snapshot" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "can_undo" BOOLEAN NOT NULL DEFAULT true,
    "undone_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_edit_snapshot_pkey" PRIMARY KEY ("id")
);

-- Create indexes for seller_analytics_event
CREATE INDEX "seller_analytics_event_member_id_created_at_idx" ON "seller_analytics_event"("member_id", "created_at");
CREATE INDEX "seller_analytics_event_store_item_id_event_type_idx" ON "seller_analytics_event"("store_item_id", "event_type");

-- Create indexes for seller_activity_log
CREATE INDEX "seller_activity_log_member_id_created_at_idx" ON "seller_activity_log"("member_id", "created_at");
CREATE INDEX "seller_activity_log_entity_type_entity_id_idx" ON "seller_activity_log"("entity_type", "entity_id");

-- Create indexes for bulk_edit_snapshot
CREATE INDEX "bulk_edit_snapshot_member_id_created_at_idx" ON "bulk_edit_snapshot"("member_id", "created_at");
CREATE INDEX "bulk_edit_snapshot_expires_at_idx" ON "bulk_edit_snapshot"("expires_at");

-- Add foreign keys for seller_analytics_event
ALTER TABLE "seller_analytics_event" ADD CONSTRAINT "seller_analytics_event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_analytics_event" ADD CONSTRAINT "seller_analytics_event_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add foreign keys for seller_activity_log
ALTER TABLE "seller_activity_log" ADD CONSTRAINT "seller_activity_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign keys for bulk_edit_snapshot
ALTER TABLE "bulk_edit_snapshot" ADD CONSTRAINT "bulk_edit_snapshot_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
