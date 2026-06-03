-- Differential reconcile baseline for channel listing links (Wix two-way sync).
-- Tracks the last agreed state (content hash + quantity + timestamp) so the reconciler
-- can tell which side changed since the last sync instead of relying on value equality.

ALTER TABLE "channel_listing_link" ADD COLUMN "sync_baseline_hash" TEXT;
ALTER TABLE "channel_listing_link" ADD COLUMN "sync_baseline_qty" INTEGER;
ALTER TABLE "channel_listing_link" ADD COLUMN "sync_baseline_at" TIMESTAMP(3);
