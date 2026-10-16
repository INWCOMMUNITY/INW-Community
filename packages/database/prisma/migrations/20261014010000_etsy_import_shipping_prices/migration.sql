-- Seller-assigned INW shipping prices for a bulk Etsy import.
-- Empty object means every listing in the batch ships free.
ALTER TABLE "etsy_import_batch"
  ADD COLUMN "shipping_prices_json" JSONB NOT NULL DEFAULT '{}';
