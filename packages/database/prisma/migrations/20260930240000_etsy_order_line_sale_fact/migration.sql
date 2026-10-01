-- E7: durable Etsy paid receipt-line sale facts.

CREATE TYPE "etsy_order_line_sale_apply_state" AS ENUM (
  'PENDING',
  'APPLIED',
  'UNMAPPED',
  'FAILED',
  'PRE_BOOTSTRAP_ACKED'
);

CREATE TABLE "etsy_order_line_sale_fact" (
  "id" TEXT NOT NULL,
  "etsy_connection_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "etsy_receipt_id" TEXT NOT NULL,
  "etsy_transaction_id" TEXT NOT NULL,
  "etsy_listing_id" TEXT,
  "etsy_product_id" TEXT,
  "etsy_offering_id" TEXT,
  "store_variant_id" TEXT,
  "store_item_id" TEXT,
  "paid_quantity" INTEGER NOT NULL,
  "applied_quantity" INTEGER NOT NULL DEFAULT 0,
  "apply_state" "etsy_order_line_sale_apply_state" NOT NULL DEFAULT 'PENDING',
  "inventory_event_id" TEXT,
  "evidence_id" TEXT NOT NULL,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "causal_conflict" BOOLEAN NOT NULL DEFAULT false,
  "causal_conflict_code" TEXT,
  "causal_conflict_evidence_id" TEXT,
  "causal_conflict_detected_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "etsy_order_line_sale_fact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_order_line_sale_fact_etsy_connection_id_etsy_receipt_id_etsy_transaction_id_key"
  ON "etsy_order_line_sale_fact"("etsy_connection_id", "etsy_receipt_id", "etsy_transaction_id");

CREATE INDEX "etsy_order_line_sale_fact_etsy_connection_id_apply_state_idx"
  ON "etsy_order_line_sale_fact"("etsy_connection_id", "apply_state");

CREATE INDEX "etsy_order_line_sale_fact_evidence_id_idx"
  ON "etsy_order_line_sale_fact"("evidence_id");

CREATE INDEX "etsy_order_line_sale_fact_store_variant_id_idx"
  ON "etsy_order_line_sale_fact"("store_variant_id");

ALTER TABLE "etsy_order_line_sale_fact"
  ADD CONSTRAINT "etsy_order_line_sale_fact_etsy_connection_id_member_id_fkey"
  FOREIGN KEY ("etsy_connection_id", "member_id") REFERENCES "etsy_connection"("id", "member_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "etsy_order_line_sale_fact"
  ADD CONSTRAINT "etsy_order_line_sale_fact_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "etsy_order_line_sale_fact"
  ADD CONSTRAINT "etsy_order_line_sale_fact_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "etsy_provider_evidence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
