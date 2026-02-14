-- AlterTable StoreItem: resale accept offers and min offer cents
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "accept_offers" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "min_offer_cents" INTEGER;
