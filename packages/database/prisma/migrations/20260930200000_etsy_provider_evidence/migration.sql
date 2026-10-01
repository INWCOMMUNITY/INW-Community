-- Etsy Marketplace V2 E3: provider evidence inbox + durable sync jobs.

CREATE TYPE "etsy_evidence_process_state" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'ERROR');
CREATE TYPE "etsy_sync_job_state" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'DEAD');
CREATE TYPE "etsy_sync_job_kind" AS ENUM ('PROCESS_PROVIDER_EVIDENCE');

CREATE TABLE "etsy_provider_evidence" (
    "id" TEXT NOT NULL,
    "etsy_connection_id" TEXT,
    "shop_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_id" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "raw_body" TEXT NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "process_state" "etsy_evidence_process_state" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etsy_provider_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_provider_evidence_webhook_id_key" ON "etsy_provider_evidence"("webhook_id");
CREATE INDEX "etsy_provider_evidence_etsy_connection_id_topic_received_at_idx" ON "etsy_provider_evidence"("etsy_connection_id", "topic", "received_at");
CREATE INDEX "etsy_provider_evidence_process_state_received_at_idx" ON "etsy_provider_evidence"("process_state", "received_at");
CREATE INDEX "etsy_provider_evidence_shop_id_triggered_at_idx" ON "etsy_provider_evidence"("shop_id", "triggered_at");
CREATE INDEX "etsy_provider_evidence_event_id_idx" ON "etsy_provider_evidence"("event_id");

ALTER TABLE "etsy_provider_evidence" ADD CONSTRAINT "etsy_provider_evidence_etsy_connection_id_fkey" FOREIGN KEY ("etsy_connection_id") REFERENCES "etsy_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "etsy_sync_job" (
    "id" TEXT NOT NULL,
    "etsy_connection_id" TEXT NOT NULL,
    "kind" "etsy_sync_job_kind" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "evidence_id" TEXT,
    "payload" JSONB,
    "payload_hash" VARCHAR(64),
    "state" "etsy_sync_job_state" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "lease_owner" TEXT,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error_class" TEXT,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "etsy_sync_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_sync_job_dedupe_key_key" ON "etsy_sync_job"("dedupe_key");
CREATE UNIQUE INDEX "etsy_sync_job_evidence_id_key" ON "etsy_sync_job"("evidence_id");
CREATE INDEX "etsy_sync_job_state_next_attempt_at_idx" ON "etsy_sync_job"("state", "next_attempt_at");
CREATE INDEX "etsy_sync_job_lease_expires_at_idx" ON "etsy_sync_job"("lease_expires_at");
CREATE INDEX "etsy_sync_job_etsy_connection_id_state_idx" ON "etsy_sync_job"("etsy_connection_id", "state");

ALTER TABLE "etsy_sync_job" ADD CONSTRAINT "etsy_sync_job_etsy_connection_id_fkey" FOREIGN KEY ("etsy_connection_id") REFERENCES "etsy_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "etsy_sync_job" ADD CONSTRAINT "etsy_sync_job_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "etsy_provider_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
