-- eBay passthrough sync: track link origin and cache live Inventory API aspects.
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "link_origin" TEXT;
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "ebay_inventory_aspects" JSONB;
