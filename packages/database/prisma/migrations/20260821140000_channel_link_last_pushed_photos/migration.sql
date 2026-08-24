-- Remember INW photo URLs after a successful channel push so Etsy title/price
-- updates do not re-upload every image (Etsy CDN URLs never match INW blob URLs).
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "last_pushed_photos" JSONB;
