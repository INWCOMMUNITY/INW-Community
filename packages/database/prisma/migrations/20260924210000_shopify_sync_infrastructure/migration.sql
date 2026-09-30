-- S3: Shopify provider-evidence inbox + durable sync-job spine.

CREATE TYPE "shopify_evidence_process_state" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'ERROR');
CREATE TYPE "shopify_sync_job_state" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'DEAD');
CREATE TYPE "shopify_sync_job_kind" AS ENUM ('PROCESS_PROVIDER_EVIDENCE');

CREATE TABLE "shopify_provider_evidence" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT,
    "shop_domain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_id" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "api_version" TEXT,
    "raw_body" TEXT NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "process_state" "shopify_evidence_process_state" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_provider_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify_sync_job" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT NOT NULL,
    "kind" "shopify_sync_job_kind" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "evidence_id" TEXT,
    "payload" JSONB,
    "payload_hash" VARCHAR(64),
    "state" "shopify_sync_job_state" NOT NULL,
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

    CONSTRAINT "shopify_sync_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_provider_evidence_webhook_id_key"
ON "shopify_provider_evidence" ("webhook_id");

CREATE INDEX "shopify_provider_evidence_connection_topic_received_idx"
ON "shopify_provider_evidence" ("shopify_connection_id", "topic", "received_at");

CREATE INDEX "shopify_provider_evidence_process_state_received_at_idx"
ON "shopify_provider_evidence" ("process_state", "received_at");

CREATE INDEX "shopify_provider_evidence_shop_domain_triggered_at_idx"
ON "shopify_provider_evidence" ("shop_domain", "triggered_at");

CREATE INDEX "shopify_provider_evidence_event_id_idx"
ON "shopify_provider_evidence" ("event_id");

CREATE UNIQUE INDEX "shopify_sync_job_dedupe_key_key"
ON "shopify_sync_job" ("dedupe_key");

CREATE UNIQUE INDEX "shopify_sync_job_evidence_id_key"
ON "shopify_sync_job" ("evidence_id");

CREATE INDEX "shopify_sync_job_state_next_attempt_at_idx"
ON "shopify_sync_job" ("state", "next_attempt_at");

CREATE INDEX "shopify_sync_job_lease_expires_at_idx"
ON "shopify_sync_job" ("lease_expires_at");

CREATE INDEX "shopify_sync_job_shopify_connection_id_state_idx"
ON "shopify_sync_job" ("shopify_connection_id", "state");

ALTER TABLE "shopify_provider_evidence"
ADD CONSTRAINT "shopify_provider_evidence_shopify_connection_id_fkey"
FOREIGN KEY ("shopify_connection_id") REFERENCES "shopify_connection"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_sync_job"
ADD CONSTRAINT "shopify_sync_job_shopify_connection_id_fkey"
FOREIGN KEY ("shopify_connection_id") REFERENCES "shopify_connection"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify_sync_job"
ADD CONSTRAINT "shopify_sync_job_evidence_id_fkey"
FOREIGN KEY ("evidence_id") REFERENCES "shopify_provider_evidence"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
