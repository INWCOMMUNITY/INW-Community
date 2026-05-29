-- Add new/used condition to store items and collapse the resale store into the main store.
ALTER TABLE "StoreItem" ADD COLUMN "condition" TEXT NOT NULL DEFAULT 'new';

-- Existing resale listings become "used" items in the main store.
UPDATE "StoreItem" SET "condition" = 'used' WHERE "listing_type" = 'resale';
UPDATE "StoreItem" SET "listing_type" = 'new' WHERE "listing_type" = 'resale';

-- Discard legacy resale offer/conversation history, keeping only accepted offers
-- that may still be linked to live carts (priceOverrideCents / resale_offer_id).
DELETE FROM "resale_message";
DELETE FROM "resale_conversation";
DELETE FROM "resale_offer" WHERE "status" <> 'accepted';
