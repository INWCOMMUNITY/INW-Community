-- Store original marketplace category on channel links for adaptive category learning.
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "remote_category_label" TEXT;
ALTER TABLE "channel_listing_link" ADD COLUMN IF NOT EXISTS "remote_category_sub_label" TEXT;
