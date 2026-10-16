-- Seller-assigned INW shipping prices for a bulk Shopify import.
-- Empty object means every product in the batch ships free.
ALTER TABLE "shopify_import_batch"
  ADD COLUMN "shipping_prices_json" JSONB NOT NULL DEFAULT '{}';
