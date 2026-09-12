-- Shopify catalog fields on StoreItem: barcode, compare-at price, tags, vendor.

ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "compare_at_price_cents" INTEGER;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
