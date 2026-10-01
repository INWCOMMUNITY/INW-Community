-- INW→Etsy CREATE_LISTING: How it's made fields + shop defaults + job kind.

ALTER TYPE "etsy_sync_job_kind" ADD VALUE IF NOT EXISTS 'CREATE_LISTING';

ALTER TABLE "StoreItem"
  ADD COLUMN IF NOT EXISTS "etsy_who_made" TEXT,
  ADD COLUMN IF NOT EXISTS "etsy_when_made" TEXT,
  ADD COLUMN IF NOT EXISTS "etsy_is_supply" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "etsy_taxonomy_id" INTEGER;

ALTER TABLE "etsy_connection"
  ADD COLUMN IF NOT EXISTS "default_shipping_profile_id" TEXT,
  ADD COLUMN IF NOT EXISTS "default_taxonomy_id" INTEGER;
