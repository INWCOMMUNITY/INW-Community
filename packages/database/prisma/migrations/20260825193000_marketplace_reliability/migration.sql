-- AlterTable
ALTER TABLE "channel_sync_event" ADD COLUMN "applied_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "channel_sync_event_applied_at_idx" ON "channel_sync_event"("applied_at");

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "tracking_status" TEXT;

-- CreateTable
CREATE TABLE "cron_job_lock" (
    "job_name" TEXT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "pass_started_at" TIMESTAMP(3),
    "last_duration_ms" INTEGER,
    "last_finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_job_lock_pkey" PRIMARY KEY ("job_name")
);

-- CreateTable
CREATE TABLE "channel_quota_usage" (
    "provider" TEXT NOT NULL,
    "date_utc" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_quota_usage_pkey" PRIMARY KEY ("provider","date_utc")
);
