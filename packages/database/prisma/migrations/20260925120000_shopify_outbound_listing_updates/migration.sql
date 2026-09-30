-- S5: outbound listing content versions/fingerprints + UPDATE_LISTING_CONTENT job kind.

ALTER TYPE "shopify_sync_job_kind" ADD VALUE 'UPDATE_LISTING_CONTENT';

ALTER TABLE "shopify_listing_link"
  ADD COLUMN "desired_product_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "applied_product_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "desired_product_fingerprint" VARCHAR(64),
  ADD COLUMN "applied_product_fingerprint" VARCHAR(64),
  ADD COLUMN "product_content_applied_at" TIMESTAMP(3);

ALTER TABLE "shopify_variant_map"
  ADD COLUMN "desired_variant_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "applied_variant_content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "desired_variant_fingerprint" VARCHAR(64),
  ADD COLUMN "applied_variant_fingerprint" VARCHAR(64),
  ADD COLUMN "variant_content_applied_at" TIMESTAMP(3);
