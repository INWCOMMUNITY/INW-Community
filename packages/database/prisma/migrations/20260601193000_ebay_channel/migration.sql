-- eBay sales-channel sync: per-connection provider config + eBay category on listings.

-- Provider-specific connection settings (eBay policy ids + merchant location; future Wix/Shopify).
ALTER TABLE "channel_connection" ADD COLUMN "config" JSONB;

-- Optional eBay leaf category id for outbound publishing (parallel to etsy_taxonomy_id).
ALTER TABLE "StoreItem" ADD COLUMN "ebay_category_id" INTEGER;
