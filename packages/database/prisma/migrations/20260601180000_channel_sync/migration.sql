-- Sales channel sync (Etsy first; eBay/Shopify/Wix later).

-- Etsy-required listing attributes that the native store does not otherwise collect.
ALTER TABLE "StoreItem" ADD COLUMN "etsy_who_made" TEXT;
ALTER TABLE "StoreItem" ADD COLUMN "etsy_when_made" TEXT;
ALTER TABLE "StoreItem" ADD COLUMN "etsy_is_supply" BOOLEAN;
ALTER TABLE "StoreItem" ADD COLUMN "etsy_taxonomy_id" INTEGER;

-- Per-seller external channel connection (encrypted OAuth tokens).
CREATE TABLE "channel_connection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_shop_id" TEXT,
    "external_shop_name" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "etsy_shipping_profile_id" TEXT,
    "last_reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_connection_member_id_provider_key" ON "channel_connection"("member_id", "provider");

ALTER TABLE "channel_connection" ADD CONSTRAINT "channel_connection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mapping between a StoreItem and one external listing per provider.
CREATE TABLE "channel_listing_link" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_listing_id" TEXT NOT NULL,
    "external_shop_id" TEXT,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "sync_error" TEXT,
    "last_pushed_hash" TEXT,
    "last_pushed_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_listing_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_listing_link_store_item_id_provider_key" ON "channel_listing_link"("store_item_id", "provider");
CREATE UNIQUE INDEX "channel_listing_link_provider_external_listing_id_key" ON "channel_listing_link"("provider", "external_listing_id");

ALTER TABLE "channel_listing_link" ADD CONSTRAINT "channel_listing_link_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_listing_link" ADD CONSTRAINT "channel_listing_link_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "channel_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inbound event dedupe (webhooks + reconciliation receipts).
CREATE TABLE "channel_sync_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "store_item_id" TEXT,
    "payload" JSONB,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_sync_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_sync_event_provider_external_event_id_key" ON "channel_sync_event"("provider", "external_event_id");
