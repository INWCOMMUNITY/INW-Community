-- E6: inbound listing content poll lease + job kind.

ALTER TYPE "etsy_sync_job_kind" ADD VALUE IF NOT EXISTS 'POLL_LISTING_CONTENT';

ALTER TABLE "etsy_connection"
  ADD COLUMN IF NOT EXISTS "listing_content_last_polled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "listing_content_poll_lease_expires_at" TIMESTAMP(3);
