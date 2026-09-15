-- Live eBay Inventory SKU pins (parent + per-variation) so qty/price catch-up
-- addresses the offer View Item reads, not an illegal hyphen parent SKU.
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "ebay_sku_map" JSONB;
