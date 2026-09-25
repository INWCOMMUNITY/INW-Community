-- S8: outbound canonical sellable inventory projection to selected Shopify location.
-- Additive only. No historical backfill. No inbound absolute sync.

CREATE TYPE "shopify_inventory_projection_init_state" AS ENUM (
  'PENDING',
  'INITIALIZED',
  'NOT_APPLICABLE',
  'FAILED'
);

CREATE TYPE "shopify_inventory_projection_drift_state" AS ENUM (
  'NONE',
  'REMOTE_DRIFT',
  'WAITING_RECONCILIATION'
);

ALTER TYPE "shopify_sync_job_kind" ADD VALUE 'PROJECT_INVENTORY';

ALTER TABLE "shopify_variant_map"
  ADD COLUMN "inventory_desired_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inventory_desired_available" INTEGER,
  ADD COLUMN "inventory_applied_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inventory_applied_available" INTEGER,
  ADD COLUMN "inventory_last_observed_available" INTEGER,
  ADD COLUMN "inventory_init_state" "shopify_inventory_projection_init_state" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "inventory_drift_state" "shopify_inventory_projection_drift_state" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "inventory_drift_code" TEXT,
  ADD COLUMN "inventory_drift_message" TEXT,
  ADD COLUMN "inventory_drift_detected_at" TIMESTAMP(3),
  ADD COLUMN "inventory_desired_at" TIMESTAMP(3),
  ADD COLUMN "inventory_applied_at" TIMESTAMP(3),
  ADD COLUMN "inventory_pending_mutation_kind" TEXT,
  ADD COLUMN "inventory_pending_idempotency_key" TEXT,
  ADD COLUMN "inventory_pending_change_from" INTEGER,
  ADD COLUMN "inventory_pending_target_qty" INTEGER,
  ADD COLUMN "inventory_pending_fingerprint" TEXT;
