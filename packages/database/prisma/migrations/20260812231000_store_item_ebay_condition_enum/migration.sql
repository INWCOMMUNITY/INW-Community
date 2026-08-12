-- Per-listing eBay Inventory API condition enum (category-specific override).

ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "ebay_condition_enum" TEXT;
