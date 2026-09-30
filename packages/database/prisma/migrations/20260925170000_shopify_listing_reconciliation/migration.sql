-- S9: listing reconciliation / readiness / per-capability pause.
-- Additive only. No historical backfill. No publication mutation.

CREATE TYPE "shopify_listing_readiness" AS ENUM (
  'SYNCING',
  'READY_TO_PUBLISH',
  'ACTION_REQUIRED',
  'CONNECTION_REQUIRED'
);

CREATE TYPE "shopify_capability_health" AS ENUM (
  'HEALTHY',
  'DEGRADED',
  'PAUSED'
);

ALTER TYPE "shopify_sync_job_kind" ADD VALUE 'RECONCILE_LISTING';

ALTER TABLE "shopify_listing_link"
  ADD COLUMN "readiness" "shopify_listing_readiness" NOT NULL DEFAULT 'SYNCING',
  ADD COLUMN "content_health" "shopify_capability_health" NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN "inventory_health" "shopify_capability_health" NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN "issue_code" TEXT,
  ADD COLUMN "issue_fingerprint" TEXT,
  ADD COLUMN "issue_severity" TEXT,
  ADD COLUMN "issue_message" TEXT,
  ADD COLUMN "issue_first_seen_at" TIMESTAMP(3),
  ADD COLUMN "issue_last_seen_at" TIMESTAMP(3),
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
  ADD COLUMN "readiness_updated_at" TIMESTAMP(3),
  ADD COLUMN "remote_product_status" TEXT;

ALTER TABLE "seller_activity_log"
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "seller_activity_log_dedupe_key_key"
  ON "seller_activity_log"("dedupe_key");
