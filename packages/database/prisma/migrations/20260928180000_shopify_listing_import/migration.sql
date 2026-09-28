-- Shopify → INW initial import: durable attempt/bootstrap cutoff + listing source + pre-bootstrap sale ack.
-- Additive only. No historical backfill. Mapping identity remains provider GIDs + durable INW IDs.

CREATE TYPE "shopify_listing_import_source" AS ENUM (
  'NATIVE',
  'SHOPIFY_IMPORT'
);

CREATE TYPE "shopify_listing_import_attempt_status" AS ENUM (
  'STARTED',
  'COMPLETED',
  'FAILED'
);

ALTER TYPE "shopify_order_line_sale_apply_state" ADD VALUE 'PRE_BOOTSTRAP_ACKED';

ALTER TABLE "shopify_listing_link"
  ADD COLUMN "import_source" "shopify_listing_import_source" NOT NULL DEFAULT 'NATIVE',
  ADD COLUMN "imported_at" TIMESTAMP(3),
  ADD COLUMN "import_bootstrap_started_at" TIMESTAMP(3);

CREATE TABLE "shopify_listing_import_attempt" (
  "id" TEXT NOT NULL,
  "shopify_connection_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "shopify_product_id" TEXT NOT NULL,
  "shopify_variant_id" TEXT,
  "shopify_inventory_item_id" TEXT,
  "status" "shopify_listing_import_attempt_status" NOT NULL DEFAULT 'STARTED',
  "stock_mode" TEXT NOT NULL,
  "bootstrap_started_at" TIMESTAMP(3) NOT NULL,
  "store_item_id" TEXT,
  "listing_link_id" TEXT,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shopify_listing_import_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_listing_import_attempt_shopify_connection_id_shopify_product_id_key"
  ON "shopify_listing_import_attempt"("shopify_connection_id", "shopify_product_id");

CREATE INDEX "shopify_listing_import_attempt_shopify_connection_id_status_idx"
  ON "shopify_listing_import_attempt"("shopify_connection_id", "status");

CREATE INDEX "shopify_listing_import_attempt_member_id_status_idx"
  ON "shopify_listing_import_attempt"("member_id", "status");

ALTER TABLE "shopify_listing_import_attempt"
  ADD CONSTRAINT "shopify_listing_import_attempt_shopify_connection_id_member_id_fkey"
  FOREIGN KEY ("shopify_connection_id", "member_id")
  REFERENCES "shopify_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_listing_import_attempt"
  ADD CONSTRAINT "shopify_listing_import_attempt_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
