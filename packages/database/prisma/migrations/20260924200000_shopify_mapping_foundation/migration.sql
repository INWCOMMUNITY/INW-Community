-- S2: generation-bound Shopify listing/variant mapping foundation.

-- Composite uniqueness for connection + member FKs from mapping rows.
CREATE UNIQUE INDEX "shopify_connection_id_member_id_key"
ON "shopify_connection" ("id", "member_id");

CREATE TABLE "shopify_listing_link" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_listing_link_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify_variant_map" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT NOT NULL,
    "shopify_listing_link_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "store_variant_id" TEXT NOT NULL,
    "shopify_variant_id" TEXT NOT NULL,
    "shopify_inventory_item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_variant_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_listing_link_shopify_connection_id_store_item_id_key"
ON "shopify_listing_link" ("shopify_connection_id", "store_item_id");

CREATE UNIQUE INDEX "shopify_listing_link_shopify_connection_id_shopify_product_id_key"
ON "shopify_listing_link" ("shopify_connection_id", "shopify_product_id");

CREATE UNIQUE INDEX "shopify_listing_link_id_connection_item_key"
ON "shopify_listing_link" ("id", "shopify_connection_id", "store_item_id");

CREATE INDEX "shopify_listing_link_member_id_store_item_id_idx"
ON "shopify_listing_link" ("member_id", "store_item_id");

CREATE UNIQUE INDEX "shopify_variant_map_shopify_connection_id_store_variant_id_key"
ON "shopify_variant_map" ("shopify_connection_id", "store_variant_id");

CREATE UNIQUE INDEX "shopify_variant_map_shopify_connection_id_shopify_variant_id_key"
ON "shopify_variant_map" ("shopify_connection_id", "shopify_variant_id");

CREATE UNIQUE INDEX "shopify_variant_map_connection_inventory_item_key"
ON "shopify_variant_map" ("shopify_connection_id", "shopify_inventory_item_id");

CREATE INDEX "shopify_variant_map_shopify_listing_link_id_idx"
ON "shopify_variant_map" ("shopify_listing_link_id");

ALTER TABLE "shopify_listing_link"
ADD CONSTRAINT "shopify_listing_link_connection_member_fkey"
FOREIGN KEY ("shopify_connection_id", "member_id") REFERENCES "shopify_connection"("id", "member_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_listing_link"
ADD CONSTRAINT "shopify_listing_link_store_item_member_fkey"
FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_listing_link"
ADD CONSTRAINT "shopify_listing_link_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "Member"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_variant_map"
ADD CONSTRAINT "shopify_variant_map_connection_member_fkey"
FOREIGN KEY ("shopify_connection_id", "member_id") REFERENCES "shopify_connection"("id", "member_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_variant_map"
ADD CONSTRAINT "shopify_variant_map_listing_connection_item_fkey"
FOREIGN KEY ("shopify_listing_link_id", "shopify_connection_id", "store_item_id")
REFERENCES "shopify_listing_link"("id", "shopify_connection_id", "store_item_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_variant_map"
ADD CONSTRAINT "shopify_variant_map_variant_item_member_fkey"
FOREIGN KEY ("store_variant_id", "store_item_id", "member_id")
REFERENCES "store_variant"("id", "store_item_id", "member_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_variant_map"
ADD CONSTRAINT "shopify_variant_map_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "Member"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
