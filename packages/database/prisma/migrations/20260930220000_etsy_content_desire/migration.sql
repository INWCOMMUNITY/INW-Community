-- E5: outbound content desire versions + UPDATE_LISTING_CONTENT job kind.

ALTER TYPE "etsy_sync_job_kind" ADD VALUE IF NOT EXISTS 'UPDATE_LISTING_CONTENT';

ALTER TABLE "etsy_listing_link"
  ADD COLUMN IF NOT EXISTS "desired_product_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "applied_product_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "desired_product_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "applied_product_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "product_content_applied_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "product_desired_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_observed_product_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "last_observed_product_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "product_content_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "product_conflict_remote_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "product_conflict_evidence_id" TEXT,
  ADD COLUMN IF NOT EXISTS "product_conflict_detected_at" TIMESTAMP(3);

ALTER TABLE "etsy_variant_map"
  ADD COLUMN IF NOT EXISTS "desired_variant_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "applied_variant_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "desired_variant_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "applied_variant_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "variant_content_applied_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "variant_desired_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_observed_variant_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "last_observed_variant_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "variant_content_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "variant_conflict_remote_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "variant_conflict_evidence_id" TEXT,
  ADD COLUMN IF NOT EXISTS "variant_conflict_detected_at" TIMESTAMP(3);
