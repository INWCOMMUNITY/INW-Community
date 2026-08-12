-- Canonical channel category → INW preset mappings (eBay/Etsy/etc.)

CREATE TABLE IF NOT EXISTS "channel_category_mapping" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "remote_label" TEXT,
    "inw_category" TEXT NOT NULL,
    "inw_subcategory" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_category_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_category_mapping_provider_match_type_match_key_key"
    ON "channel_category_mapping"("provider", "match_type", "match_key");

CREATE INDEX IF NOT EXISTS "channel_category_mapping_provider_match_type_active_idx"
    ON "channel_category_mapping"("provider", "match_type", "active");
