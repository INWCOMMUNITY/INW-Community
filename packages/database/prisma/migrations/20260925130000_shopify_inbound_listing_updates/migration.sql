-- S6: inbound observation/desired-at markers for most-recent-edit wins.

ALTER TABLE "shopify_listing_link"
  ADD COLUMN "product_desired_at" TIMESTAMP(3),
  ADD COLUMN "last_observed_product_fingerprint" VARCHAR(64),
  ADD COLUMN "last_observed_product_updated_at" TIMESTAMP(3);

ALTER TABLE "shopify_variant_map"
  ADD COLUMN "variant_desired_at" TIMESTAMP(3),
  ADD COLUMN "last_observed_variant_fingerprint" VARCHAR(64),
  ADD COLUMN "last_observed_variant_updated_at" TIMESTAMP(3);
