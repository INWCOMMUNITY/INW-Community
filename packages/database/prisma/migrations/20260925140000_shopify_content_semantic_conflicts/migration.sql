-- S6 repair: per-group semantic content conflict markers (no timestamp winners).

ALTER TABLE "shopify_listing_link"
  ADD COLUMN "product_content_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "product_conflict_remote_fingerprint" VARCHAR(64),
  ADD COLUMN "product_conflict_evidence_id" TEXT,
  ADD COLUMN "product_conflict_detected_at" TIMESTAMP(3);

ALTER TABLE "shopify_variant_map"
  ADD COLUMN "variant_content_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "variant_conflict_remote_fingerprint" VARCHAR(64),
  ADD COLUMN "variant_conflict_evidence_id" TEXT,
  ADD COLUMN "variant_conflict_detected_at" TIMESTAMP(3);
