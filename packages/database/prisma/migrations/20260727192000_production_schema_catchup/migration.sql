-- Production schema catch-up (idempotent).
-- Adds columns/tables that were introduced in schema.prisma without dedicated migrations.

-- Member profile cover photo (mobile + web profile)
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "cover_photo_url" TEXT;

-- Post @updatedAt
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Channel sync retry queue
CREATE TABLE IF NOT EXISTS "channel_sync_retry" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "retry_type" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_sync_retry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "channel_sync_retry_next_retry_at_idx" ON "channel_sync_retry"("next_retry_at");

DO $$ BEGIN
    ALTER TABLE "channel_sync_retry" ADD CONSTRAINT "channel_sync_retry_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "channel_listing_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Seller-visible channel sync activity log
CREATE TABLE IF NOT EXISTS "channel_sync_log" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "store_item_id" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_sync_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "channel_sync_log_member_id_created_at_idx" ON "channel_sync_log"("member_id", "created_at");
CREATE INDEX IF NOT EXISTS "channel_sync_log_store_item_id_idx" ON "channel_sync_log"("store_item_id");

-- Webhook event log (cron cleanup + durable processing)
CREATE TABLE IF NOT EXISTS "channel_webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_event_id" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "channel_webhook_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "channel_webhook_event_provider_status_idx" ON "channel_webhook_event"("provider", "status");
CREATE INDEX IF NOT EXISTS "channel_webhook_event_status_created_at_idx" ON "channel_webhook_event"("status", "created_at");

-- Post polls
CREATE TABLE IF NOT EXISTS "post_poll" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_poll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_poll_post_id_key" ON "post_poll"("post_id");

DO $$ BEGIN
    ALTER TABLE "post_poll" ADD CONSTRAINT "post_poll_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "post_poll_option" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "post_poll_option_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "post_poll_option_poll_id_idx" ON "post_poll_option"("poll_id");

DO $$ BEGIN
    ALTER TABLE "post_poll_option" ADD CONSTRAINT "post_poll_option_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "post_poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "post_poll_vote" (
    "id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_poll_vote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_poll_vote_option_id_member_id_key" ON "post_poll_vote"("option_id", "member_id");
CREATE INDEX IF NOT EXISTS "post_poll_vote_member_id_idx" ON "post_poll_vote"("member_id");

DO $$ BEGIN
    ALTER TABLE "post_poll_vote" ADD CONSTRAINT "post_poll_vote_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "post_poll_option"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "post_poll_vote" ADD CONSTRAINT "post_poll_vote_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
