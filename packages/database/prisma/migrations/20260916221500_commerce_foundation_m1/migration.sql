-- Commerce foundation M1: additive Variant/inventory identity only.
-- Does not backfill rows, mutate existing StoreItem quantity/variants/sku,
-- change OrderItem→StoreItem CASCADE, or add marketplace tables.
--
-- Deferred (later migrations / after backfill):
-- * at-least-one Variant and exactly-one default per StoreItem (app + verify)
-- * CartItem.variantId / OrderItem.variantId NOT NULL
-- * active non-null SKU unique per seller
-- * OrderItem.storeItemId ON DELETE RESTRICT

-- CreateEnum
CREATE TYPE "store_variant_status" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "inventory_mode" AS ENUM ('TRACKED_FINITE', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "inventory_event_type" AS ENUM (
    'SALE',
    'SET',
    'ADJUSTMENT',
    'RESERVATION_HOLD',
    'RESERVATION_RELEASE',
    'RESERVATION_CONVERT',
    'RESERVATION_INVALIDATE',
    'UNDO_CONSUMPTION',
    'PHYSICAL_RECEIPT',
    'OPENING_BALANCE',
    'CORRECTION'
);

-- AlterTable: semantic versions (existing rows receive 1; no rewrite of inventory)
ALTER TABLE "StoreItem" ADD COLUMN "content_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StoreItem" ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_content_version_check" CHECK ("content_version" >= 1);
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_lifecycle_version_check" CHECK ("lifecycle_version" >= 1);

-- Composite uniqueness so children can FK (storeItemId, memberId) as one listing+tenant
CREATE UNIQUE INDEX "StoreItem_id_member_id_key" ON "StoreItem"("id", "member_id");

-- CreateTable
CREATE TABLE "store_variant" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "status" "store_variant_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sku" TEXT,
    "barcode" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "price_cents" INTEGER NOT NULL,
    "compare_at_price_cents" INTEGER,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offer_version" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "store_variant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_variant_offer_version_check" CHECK ("offer_version" >= 1)
);

CREATE UNIQUE INDEX "store_variant_id_member_id_key" ON "store_variant"("id", "member_id");
CREATE UNIQUE INDEX "store_variant_id_store_item_id_key" ON "store_variant"("id", "store_item_id");
CREATE UNIQUE INDEX "store_variant_id_store_item_id_member_id_key" ON "store_variant"("id", "store_item_id", "member_id");
CREATE INDEX "store_variant_store_item_id_status_idx" ON "store_variant"("store_item_id", "status");
CREATE INDEX "store_variant_member_id_status_idx" ON "store_variant"("member_id", "status");

-- At most one default Variant per listing. At-least-one is NOT enforced here.
CREATE UNIQUE INDEX "store_variant_one_default_per_item" ON "store_variant"("store_item_id") WHERE "is_default" = true;

ALTER TABLE "store_variant" ADD CONSTRAINT "store_variant_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_variant" ADD CONSTRAINT "store_variant_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "inventory_state" (
    "variant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "mode" "inventory_mode" NOT NULL,
    "on_hand" INTEGER,
    "reserved" INTEGER,
    "availability_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_state_pkey" PRIMARY KEY ("variant_id"),
    CONSTRAINT "inventory_state_availability_version_check" CHECK ("availability_version" >= 1),
    CONSTRAINT "inventory_state_mode_qty_check" CHECK (
        (
            "mode" = 'TRACKED_FINITE'
            AND "on_hand" IS NOT NULL
            AND "reserved" IS NOT NULL
            AND "on_hand" >= 0
            AND "reserved" >= 0
            AND "reserved" <= "on_hand"
        )
        OR
        (
            "mode" = 'MADE_TO_ORDER'
            AND "on_hand" IS NULL
            AND "reserved" IS NULL
        )
    )
);

CREATE UNIQUE INDEX "inventory_state_variant_id_member_id_key" ON "inventory_state"("variant_id", "member_id");
CREATE UNIQUE INDEX "inventory_state_variant_id_store_item_id_member_id_key" ON "inventory_state"("variant_id", "store_item_id", "member_id");
CREATE INDEX "inventory_state_store_item_id_idx" ON "inventory_state"("store_item_id");

ALTER TABLE "inventory_state" ADD CONSTRAINT "inventory_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_state" ADD CONSTRAINT "inventory_state_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_state" ADD CONSTRAINT "inventory_state_variant_id_store_item_id_member_id_fkey" FOREIGN KEY ("variant_id", "store_item_id", "member_id") REFERENCES "store_variant"("id", "store_item_id", "member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "inventory_event" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "event_type" "inventory_event_type" NOT NULL,
    "cause" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_scope" TEXT NOT NULL DEFAULT '',
    "source_fact_id" TEXT NOT NULL,
    "requested_qty" INTEGER NOT NULL DEFAULT 0,
    "applied_on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "applied_reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "shortage_qty" INTEGER NOT NULL DEFAULT 0,
    "displaced_reservation_qty" INTEGER NOT NULL DEFAULT 0,
    "on_hand_before" INTEGER,
    "on_hand_after" INTEGER,
    "reserved_before" INTEGER,
    "reserved_after" INTEGER,
    "command_id" TEXT,
    "expected_availability_version" INTEGER,
    "target_on_hand" INTEGER,
    "original_sale_event_id" TEXT,
    "order_item_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_event_qty_nonnegative_check" CHECK (
        "requested_qty" >= 0
        AND "applied_on_hand_qty" >= 0
        AND "applied_reserved_qty" >= 0
        AND "shortage_qty" >= 0
        AND "displaced_reservation_qty" >= 0
    )
);

CREATE UNIQUE INDEX "inventory_event_causal_key" ON "inventory_event"("member_id", "source_system", "source_scope", "event_type", "source_fact_id");
CREATE INDEX "inventory_event_variant_id_created_at_idx" ON "inventory_event"("variant_id", "created_at");
CREATE INDEX "inventory_event_original_sale_event_id_event_type_idx" ON "inventory_event"("original_sale_event_id", "event_type");
CREATE INDEX "inventory_event_order_item_id_idx" ON "inventory_event"("order_item_id");

ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_variant_id_store_item_id_member_id_fkey" FOREIGN KEY ("variant_id", "store_item_id", "member_id") REFERENCES "store_variant"("id", "store_item_id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_original_sale_event_id_fkey" FOREIGN KEY ("original_sale_event_id") REFERENCES "inventory_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "variant_backfill_map" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_backfill_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_backfill_map_variant_id_key" ON "variant_backfill_map"("variant_id");
CREATE UNIQUE INDEX "variant_backfill_map_store_item_id_source_fingerprint_key" ON "variant_backfill_map"("store_item_id", "source_fingerprint");

ALTER TABLE "variant_backfill_map" ADD CONSTRAINT "variant_backfill_map_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_backfill_map" ADD CONSTRAINT "variant_backfill_map_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_backfill_map" ADD CONSTRAINT "variant_backfill_map_variant_id_store_item_id_member_id_fkey" FOREIGN KEY ("variant_id", "store_item_id", "member_id") REFERENCES "store_variant"("id", "store_item_id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: nullable Variant refs for existing carts/orders (no backfill)
ALTER TABLE "CartItem" ADD COLUMN "variant_id" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "variant_id" TEXT;

CREATE INDEX "CartItem_variant_id_idx" ON "CartItem"("variant_id");
CREATE INDEX "OrderItem_variant_id_idx" ON "OrderItem"("variant_id");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "store_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "store_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MATCH SIMPLE: NULL variant_id is allowed; when set, Variant must belong to the same StoreItem.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variant_id_store_item_id_fkey" FOREIGN KEY ("variant_id", "store_item_id") REFERENCES "store_variant"("id", "store_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variant_id_store_item_id_fkey" FOREIGN KEY ("variant_id", "store_item_id") REFERENCES "store_variant"("id", "store_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
