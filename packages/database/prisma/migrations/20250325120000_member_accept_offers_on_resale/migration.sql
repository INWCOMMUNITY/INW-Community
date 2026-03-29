-- Default for new resale listings; per-listing accept_offers on StoreItem overrides.
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "accept_offers_on_resale" BOOLEAN NOT NULL DEFAULT true;
