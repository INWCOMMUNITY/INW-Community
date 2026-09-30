-- S7 repair: durable anomaly metadata for conflicting paid-order sale-fact replays.
-- Does not mutate original paidQuantity / shopifyVariantId / storeVariantId.

ALTER TABLE "shopify_order_line_sale_fact"
  ADD COLUMN "causal_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "causal_conflict_code" TEXT,
  ADD COLUMN "causal_conflict_evidence_id" TEXT,
  ADD COLUMN "causal_conflict_detected_at" TIMESTAMP(3);
