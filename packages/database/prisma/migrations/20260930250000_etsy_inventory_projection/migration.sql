-- E8: outbound inventory projection versions + PROJECT_INVENTORY job kind.

ALTER TYPE "etsy_sync_job_kind" ADD VALUE IF NOT EXISTS 'PROJECT_INVENTORY';

ALTER TABLE "etsy_variant_map"
  ADD COLUMN IF NOT EXISTS "inventory_desired_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inventory_applied_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inventory_desired_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inventory_applied_at" TIMESTAMP(3);
