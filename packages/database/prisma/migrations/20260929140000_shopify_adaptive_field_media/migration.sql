-- Adaptive bidirectional sync: per-field semantic state + durable media identity maps.

CREATE TYPE "shopify_content_field_key" AS ENUM (
  'TITLE',
  'DESCRIPTION',
  'MEDIA',
  'VENDOR',
  'TAGS',
  'ASPECTS',
  'PRICE',
  'SKU',
  'BARCODE',
  'COMPARE_AT'
);

CREATE TYPE "shopify_media_map_status" AS ENUM (
  'ACTIVE',
  'REMOVED',
  'PENDING_REMOTE',
  'PENDING_LOCAL'
);

CREATE TABLE "shopify_listing_field_state" (
  "id" TEXT NOT NULL,
  "shopify_connection_id" TEXT NOT NULL,
  "shopify_listing_link_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "store_item_id" TEXT NOT NULL,
  "store_variant_id" TEXT NOT NULL DEFAULT '',
  "field_key" "shopify_content_field_key" NOT NULL,
  "base_fingerprint" VARCHAR(64),
  "local_fingerprint" VARCHAR(64),
  "remote_fingerprint" VARCHAR(64),
  "conflict" BOOLEAN NOT NULL DEFAULT false,
  "conflict_remote_fingerprint" VARCHAR(64),
  "conflict_evidence_id" TEXT,
  "conflict_detected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shopify_listing_field_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_listing_field_state_shopify_listing_link_id_store_variant_id_field_key_key"
  ON "shopify_listing_field_state"("shopify_listing_link_id", "store_variant_id", "field_key");

CREATE INDEX "shopify_listing_field_state_shopify_listing_link_id_conflict_idx"
  ON "shopify_listing_field_state"("shopify_listing_link_id", "conflict");

CREATE INDEX "shopify_listing_field_state_shopify_connection_id_store_item_id_idx"
  ON "shopify_listing_field_state"("shopify_connection_id", "store_item_id");

ALTER TABLE "shopify_listing_field_state"
  ADD CONSTRAINT "shopify_listing_field_state_shopify_listing_link_id_fkey"
  FOREIGN KEY ("shopify_listing_link_id") REFERENCES "shopify_listing_link"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shopify_media_map" (
  "id" TEXT NOT NULL,
  "shopify_connection_id" TEXT NOT NULL,
  "shopify_listing_link_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "store_item_id" TEXT NOT NULL,
  "store_variant_id" TEXT,
  "inw_media_id" TEXT NOT NULL,
  "source_url" TEXT,
  "content_sha256" VARCHAR(64),
  "shopify_media_id" TEXT,
  "shopify_file_id" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "alt_text" TEXT,
  "status" "shopify_media_map_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shopify_media_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_media_map_shopify_listing_link_id_inw_media_id_key"
  ON "shopify_media_map"("shopify_listing_link_id", "inw_media_id");

CREATE INDEX "shopify_media_map_shopify_listing_link_id_status_position_idx"
  ON "shopify_media_map"("shopify_listing_link_id", "status", "position");

CREATE INDEX "shopify_media_map_shopify_connection_id_shopify_media_id_idx"
  ON "shopify_media_map"("shopify_connection_id", "shopify_media_id");

ALTER TABLE "shopify_media_map"
  ADD CONSTRAINT "shopify_media_map_shopify_listing_link_id_fkey"
  FOREIGN KEY ("shopify_listing_link_id") REFERENCES "shopify_listing_link"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
