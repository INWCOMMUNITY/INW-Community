-- Etsy Marketplace V2 E4: listing/variant mapping + import attempts.

CREATE TYPE "etsy_listing_import_source" AS ENUM ('NATIVE', 'ETSY_IMPORT');
CREATE TYPE "etsy_listing_import_attempt_status" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');
CREATE TYPE "etsy_listing_readiness" AS ENUM ('SYNCING', 'READY_TO_PUBLISH', 'ACTION_REQUIRED', 'CONNECTION_REQUIRED');
CREATE TYPE "etsy_capability_health" AS ENUM ('HEALTHY', 'DEGRADED', 'PAUSED');

CREATE TABLE "etsy_listing_import_attempt" (
    "id" TEXT NOT NULL,
    "etsy_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "etsy_listing_id" TEXT NOT NULL,
    "etsy_product_id" TEXT,
    "etsy_offering_id" TEXT,
    "status" "etsy_listing_import_attempt_status" NOT NULL DEFAULT 'STARTED',
    "stock_mode" TEXT NOT NULL,
    "bootstrap_started_at" TIMESTAMP(3) NOT NULL,
    "store_item_id" TEXT,
    "listing_link_id" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etsy_listing_import_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_listing_import_attempt_etsy_connection_id_etsy_listing_id_key"
  ON "etsy_listing_import_attempt"("etsy_connection_id", "etsy_listing_id");
CREATE INDEX "etsy_listing_import_attempt_etsy_connection_id_status_idx"
  ON "etsy_listing_import_attempt"("etsy_connection_id", "status");
CREATE INDEX "etsy_listing_import_attempt_member_id_status_idx"
  ON "etsy_listing_import_attempt"("member_id", "status");

ALTER TABLE "etsy_listing_import_attempt"
  ADD CONSTRAINT "etsy_listing_import_attempt_etsy_connection_id_member_id_fkey"
  FOREIGN KEY ("etsy_connection_id", "member_id") REFERENCES "etsy_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_listing_import_attempt"
  ADD CONSTRAINT "etsy_listing_import_attempt_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "etsy_listing_link" (
    "id" TEXT NOT NULL,
    "etsy_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "etsy_listing_id" TEXT NOT NULL,
    "remote_listing_state" TEXT,
    "readiness" "etsy_listing_readiness" NOT NULL DEFAULT 'SYNCING',
    "content_health" "etsy_capability_health" NOT NULL DEFAULT 'HEALTHY',
    "inventory_health" "etsy_capability_health" NOT NULL DEFAULT 'HEALTHY',
    "issue_code" TEXT,
    "issue_message" TEXT,
    "import_source" "etsy_listing_import_source" NOT NULL DEFAULT 'NATIVE',
    "imported_at" TIMESTAMP(3),
    "import_bootstrap_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etsy_listing_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_listing_link_id_etsy_connection_id_store_item_id_key"
  ON "etsy_listing_link"("id", "etsy_connection_id", "store_item_id");
CREATE UNIQUE INDEX "etsy_listing_link_etsy_connection_id_store_item_id_key"
  ON "etsy_listing_link"("etsy_connection_id", "store_item_id");
CREATE UNIQUE INDEX "etsy_listing_link_etsy_connection_id_etsy_listing_id_key"
  ON "etsy_listing_link"("etsy_connection_id", "etsy_listing_id");
CREATE INDEX "etsy_listing_link_member_id_readiness_idx"
  ON "etsy_listing_link"("member_id", "readiness");
CREATE INDEX "etsy_listing_link_etsy_connection_id_import_source_idx"
  ON "etsy_listing_link"("etsy_connection_id", "import_source");

ALTER TABLE "etsy_listing_link"
  ADD CONSTRAINT "etsy_listing_link_etsy_connection_id_member_id_fkey"
  FOREIGN KEY ("etsy_connection_id", "member_id") REFERENCES "etsy_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_listing_link"
  ADD CONSTRAINT "etsy_listing_link_store_item_id_member_id_fkey"
  FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_listing_link"
  ADD CONSTRAINT "etsy_listing_link_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "etsy_variant_map" (
    "id" TEXT NOT NULL,
    "etsy_connection_id" TEXT NOT NULL,
    "etsy_listing_link_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "store_variant_id" TEXT NOT NULL,
    "etsy_product_id" TEXT NOT NULL,
    "etsy_offering_id" TEXT NOT NULL,
    "property_values_json" JSONB,
    "remote_sku" TEXT,
    "inventory_desired_available" INTEGER,
    "inventory_applied_available" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etsy_variant_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_variant_map_etsy_connection_id_store_variant_id_key"
  ON "etsy_variant_map"("etsy_connection_id", "store_variant_id");
CREATE UNIQUE INDEX "etsy_variant_map_etsy_connection_id_etsy_product_id_key"
  ON "etsy_variant_map"("etsy_connection_id", "etsy_product_id");
CREATE UNIQUE INDEX "etsy_variant_map_etsy_connection_id_etsy_offering_id_key"
  ON "etsy_variant_map"("etsy_connection_id", "etsy_offering_id");
CREATE INDEX "etsy_variant_map_etsy_listing_link_id_idx"
  ON "etsy_variant_map"("etsy_listing_link_id");
CREATE INDEX "etsy_variant_map_member_id_store_item_id_idx"
  ON "etsy_variant_map"("member_id", "store_item_id");

ALTER TABLE "etsy_variant_map"
  ADD CONSTRAINT "etsy_variant_map_etsy_connection_id_member_id_fkey"
  FOREIGN KEY ("etsy_connection_id", "member_id") REFERENCES "etsy_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_variant_map"
  ADD CONSTRAINT "etsy_variant_map_etsy_listing_link_id_etsy_connection_id_store_item_id_fkey"
  FOREIGN KEY ("etsy_listing_link_id", "etsy_connection_id", "store_item_id")
  REFERENCES "etsy_listing_link"("id", "etsy_connection_id", "store_item_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_variant_map"
  ADD CONSTRAINT "etsy_variant_map_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
