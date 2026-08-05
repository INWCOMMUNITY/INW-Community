-- Multi-Platform Listing System: Category Mapping, Quantity Audit, Sync Health

-- Add conflict tracking fields to ChannelListingLink
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "last_conflict_at" TIMESTAMP(3);
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "conflict_resolution" TEXT;
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "conflict_details" JSONB;

-- CreateTable: CategoryMappingFeedback
-- Tracks seller corrections to auto-mapped categories for ML learning
CREATE TABLE IF NOT EXISTS "category_mapping_feedback" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "remote_category" TEXT NOT NULL,
    "remote_subcategory" TEXT,
    "auto_mapped" TEXT NOT NULL,
    "auto_mapped_subcategory" TEXT,
    "seller_chosen" TEXT NOT NULL,
    "seller_chosen_subcategory" TEXT,
    "confidence" DOUBLE PRECISION,
    "store_item_id" TEXT,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_mapping_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CategoryMappingFeedback
CREATE INDEX IF NOT EXISTS "category_mapping_feedback_provider_remote_category_idx" ON "category_mapping_feedback"("provider", "remote_category");
CREATE INDEX IF NOT EXISTS "category_mapping_feedback_member_id_idx" ON "category_mapping_feedback"("member_id");

-- CreateTable: CategoryMappingStats
-- Aggregated stats for improving auto-mapping accuracy over time
CREATE TABLE IF NOT EXISTS "category_mapping_stats" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "remote_category" TEXT NOT NULL,
    "mapped_category" TEXT NOT NULL,
    "mapped_subcategory" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "override_count" INTEGER NOT NULL DEFAULT 0,
    "keep_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_mapping_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CategoryMappingStats
CREATE UNIQUE INDEX IF NOT EXISTS "category_mapping_stats_provider_remote_category_key" ON "category_mapping_stats"("provider", "remote_category");

-- CreateTable: QuantityAuditLog
-- Full audit trail for all quantity changes across platforms
CREATE TABLE IF NOT EXISTS "quantity_audit_log" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "previous_qty" INTEGER NOT NULL,
    "new_qty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "external_event_id" TEXT,
    "order_id" TEXT,
    "variant_value" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quantity_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: QuantityAuditLog
CREATE INDEX IF NOT EXISTS "quantity_audit_log_store_item_id_created_at_idx" ON "quantity_audit_log"("store_item_id", "created_at");
CREATE INDEX IF NOT EXISTS "quantity_audit_log_member_id_created_at_idx" ON "quantity_audit_log"("member_id", "created_at");
CREATE INDEX IF NOT EXISTS "quantity_audit_log_provider_created_at_idx" ON "quantity_audit_log"("provider", "created_at");
