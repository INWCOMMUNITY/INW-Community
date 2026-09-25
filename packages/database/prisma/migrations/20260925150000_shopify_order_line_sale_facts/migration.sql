-- S7: durable Shopify paid order-line sale facts for exactly-once inventory causality.

CREATE TYPE "shopify_order_line_sale_apply_state" AS ENUM ('PENDING', 'APPLIED', 'UNMAPPED', 'FAILED');

CREATE TABLE "shopify_order_line_sale_fact" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "shopify_order_id" TEXT NOT NULL,
    "shopify_line_item_id" TEXT NOT NULL,
    "shopify_variant_id" TEXT,
    "store_variant_id" TEXT,
    "store_item_id" TEXT,
    "paid_quantity" INTEGER NOT NULL,
    "applied_quantity" INTEGER NOT NULL DEFAULT 0,
    "apply_state" "shopify_order_line_sale_apply_state" NOT NULL DEFAULT 'PENDING',
    "inventory_event_id" TEXT,
    "evidence_id" TEXT NOT NULL,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_order_line_sale_fact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_order_line_sale_fact_shopify_connection_id_shopify_order_id_shopify_line_item_id_key"
  ON "shopify_order_line_sale_fact"("shopify_connection_id", "shopify_order_id", "shopify_line_item_id");

CREATE INDEX "shopify_order_line_sale_fact_shopify_connection_id_apply_state_idx"
  ON "shopify_order_line_sale_fact"("shopify_connection_id", "apply_state");

CREATE INDEX "shopify_order_line_sale_fact_evidence_id_idx"
  ON "shopify_order_line_sale_fact"("evidence_id");

CREATE INDEX "shopify_order_line_sale_fact_store_variant_id_idx"
  ON "shopify_order_line_sale_fact"("store_variant_id");

ALTER TABLE "shopify_order_line_sale_fact"
  ADD CONSTRAINT "shopify_order_line_sale_fact_shopify_connection_id_member_id_fkey"
  FOREIGN KEY ("shopify_connection_id", "member_id") REFERENCES "shopify_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_order_line_sale_fact"
  ADD CONSTRAINT "shopify_order_line_sale_fact_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_order_line_sale_fact"
  ADD CONSTRAINT "shopify_order_line_sale_fact_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "shopify_provider_evidence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
