-- CreateEnum
CREATE TYPE "wix_connection_status" AS ENUM ('ACTIVE', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "wix_catalog_version" AS ENUM ('V1_CATALOG', 'V3_CATALOG');

-- CreateEnum
CREATE TYPE "wix_listing_import_source" AS ENUM ('NATIVE', 'WIX_IMPORT');

-- CreateEnum
CREATE TYPE "wix_listing_import_attempt_status" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "wix_listing_readiness" AS ENUM ('SYNCING', 'READY_TO_PUBLISH', 'ACTION_REQUIRED', 'CONNECTION_REQUIRED');

-- CreateEnum
CREATE TYPE "wix_capability_health" AS ENUM ('HEALTHY', 'DEGRADED', 'PAUSED');

-- CreateEnum
CREATE TYPE "wix_evidence_process_state" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'ERROR');

-- CreateEnum
CREATE TYPE "wix_sync_job_state" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'DEAD');

-- CreateEnum
CREATE TYPE "wix_sync_job_kind" AS ENUM ('PROCESS_PROVIDER_EVIDENCE', 'UPDATE_LISTING_CONTENT', 'POLL_LISTING_CONTENT', 'PROJECT_INVENTORY', 'RECONCILE_LISTING', 'CREATE_LISTING');

-- CreateEnum
CREATE TYPE "wix_order_line_sale_apply_state" AS ENUM ('PENDING', 'APPLIED', 'UNMAPPED', 'FAILED', 'PRE_BOOTSTRAP_ACKED');

-- CreateTable
CREATE TABLE "wix_connection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "shop_name" TEXT,
    "catalog_version" "wix_catalog_version" NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" "wix_connection_status" NOT NULL,
    "default_location_id" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_listing_import_attempt" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "wix_product_id" TEXT NOT NULL,
    "wix_variant_id" TEXT,
    "status" "wix_listing_import_attempt_status" NOT NULL DEFAULT 'STARTED',
    "stock_mode" TEXT NOT NULL,
    "bootstrap_started_at" TIMESTAMP(3) NOT NULL,
    "store_item_id" TEXT,
    "listing_link_id" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_listing_import_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_listing_link" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "wix_product_id" TEXT NOT NULL,
    "desired_product_content_version" INTEGER NOT NULL DEFAULT 0,
    "applied_product_content_version" INTEGER NOT NULL DEFAULT 0,
    "desired_product_fingerprint" VARCHAR(64),
    "applied_product_fingerprint" VARCHAR(64),
    "product_content_applied_at" TIMESTAMP(3),
    "product_desired_at" TIMESTAMP(3),
    "last_observed_product_fingerprint" VARCHAR(64),
    "last_observed_product_updated_at" TIMESTAMP(3),
    "product_content_conflict" BOOLEAN NOT NULL DEFAULT false,
    "product_conflict_remote_fingerprint" VARCHAR(64),
    "product_conflict_evidence_id" TEXT,
    "product_conflict_detected_at" TIMESTAMP(3),
    "readiness" "wix_listing_readiness" NOT NULL DEFAULT 'SYNCING',
    "content_health" "wix_capability_health" NOT NULL DEFAULT 'HEALTHY',
    "inventory_health" "wix_capability_health" NOT NULL DEFAULT 'HEALTHY',
    "issue_code" TEXT,
    "issue_fingerprint" TEXT,
    "issue_severity" TEXT,
    "issue_message" TEXT,
    "issue_first_seen_at" TIMESTAMP(3),
    "issue_last_seen_at" TIMESTAMP(3),
    "last_reconciled_at" TIMESTAMP(3),
    "readiness_updated_at" TIMESTAMP(3),
    "remote_product_visible" BOOLEAN,
    "import_source" "wix_listing_import_source" NOT NULL DEFAULT 'NATIVE',
    "imported_at" TIMESTAMP(3),
    "import_bootstrap_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_listing_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_variant_map" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT NOT NULL,
    "wix_listing_link_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "store_variant_id" TEXT NOT NULL,
    "wix_variant_id" TEXT NOT NULL,
    "wix_inventory_item_id" TEXT,
    "choices_json" JSONB,
    "remote_sku" TEXT,
    "desired_variant_content_version" INTEGER NOT NULL DEFAULT 0,
    "applied_variant_content_version" INTEGER NOT NULL DEFAULT 0,
    "desired_variant_fingerprint" VARCHAR(64),
    "applied_variant_fingerprint" VARCHAR(64),
    "variant_content_applied_at" TIMESTAMP(3),
    "variant_desired_at" TIMESTAMP(3),
    "last_observed_variant_fingerprint" VARCHAR(64),
    "last_observed_variant_updated_at" TIMESTAMP(3),
    "variant_content_conflict" BOOLEAN NOT NULL DEFAULT false,
    "variant_conflict_remote_fingerprint" VARCHAR(64),
    "variant_conflict_evidence_id" TEXT,
    "variant_conflict_detected_at" TIMESTAMP(3),
    "inventory_desired_available" INTEGER,
    "inventory_applied_available" INTEGER,
    "inventory_desired_version" INTEGER NOT NULL DEFAULT 0,
    "inventory_applied_version" INTEGER NOT NULL DEFAULT 0,
    "inventory_desired_at" TIMESTAMP(3),
    "inventory_applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_variant_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_provider_evidence" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT,
    "site_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_id" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "raw_body" TEXT NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "process_state" "wix_evidence_process_state" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_provider_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_order_line_sale_fact" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "wix_order_id" TEXT NOT NULL,
    "wix_line_item_id" TEXT NOT NULL,
    "wix_product_id" TEXT,
    "wix_variant_id" TEXT,
    "store_variant_id" TEXT,
    "store_item_id" TEXT,
    "paid_quantity" INTEGER NOT NULL,
    "applied_quantity" INTEGER NOT NULL DEFAULT 0,
    "apply_state" "wix_order_line_sale_apply_state" NOT NULL DEFAULT 'PENDING',
    "inventory_event_id" TEXT,
    "evidence_id" TEXT NOT NULL,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "causal_conflict" BOOLEAN NOT NULL DEFAULT false,
    "causal_conflict_code" TEXT,
    "causal_conflict_evidence_id" TEXT,
    "causal_conflict_detected_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wix_order_line_sale_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_sync_job" (
    "id" TEXT NOT NULL,
    "wix_connection_id" TEXT NOT NULL,
    "kind" "wix_sync_job_kind" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "evidence_id" TEXT,
    "payload" JSONB,
    "payload_hash" VARCHAR(64),
    "state" "wix_sync_job_state" NOT NULL,
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

    CONSTRAINT "wix_sync_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wix_oauth_state" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "browser_binding_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wix_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wix_connection_member_id_status_idx" ON "wix_connection"("member_id", "status");

-- CreateIndex
CREATE INDEX "wix_connection_site_id_status_idx" ON "wix_connection"("site_id", "status");

-- CreateIndex
CREATE INDEX "wix_connection_instance_id_status_idx" ON "wix_connection"("instance_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wix_connection_id_member_id_key" ON "wix_connection"("id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_connection_member_id_site_id_generation_key" ON "wix_connection"("member_id", "site_id", "generation");

-- CreateIndex
CREATE INDEX "wix_listing_import_attempt_wix_connection_id_status_idx" ON "wix_listing_import_attempt"("wix_connection_id", "status");

-- CreateIndex
CREATE INDEX "wix_listing_import_attempt_member_id_status_idx" ON "wix_listing_import_attempt"("member_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wix_listing_import_attempt_wix_connection_id_wix_product_id_key" ON "wix_listing_import_attempt"("wix_connection_id", "wix_product_id");

-- CreateIndex
CREATE INDEX "wix_listing_link_member_id_readiness_idx" ON "wix_listing_link"("member_id", "readiness");

-- CreateIndex
CREATE INDEX "wix_listing_link_wix_connection_id_import_source_idx" ON "wix_listing_link"("wix_connection_id", "import_source");

-- CreateIndex
CREATE UNIQUE INDEX "wix_listing_link_id_wix_connection_id_store_item_id_key" ON "wix_listing_link"("id", "wix_connection_id", "store_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_listing_link_wix_connection_id_store_item_id_key" ON "wix_listing_link"("wix_connection_id", "store_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_listing_link_wix_connection_id_wix_product_id_key" ON "wix_listing_link"("wix_connection_id", "wix_product_id");

-- CreateIndex
CREATE INDEX "wix_variant_map_wix_listing_link_id_idx" ON "wix_variant_map"("wix_listing_link_id");

-- CreateIndex
CREATE INDEX "wix_variant_map_member_id_store_item_id_idx" ON "wix_variant_map"("member_id", "store_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_variant_map_wix_connection_id_store_variant_id_key" ON "wix_variant_map"("wix_connection_id", "store_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_variant_map_wix_connection_id_wix_variant_id_key" ON "wix_variant_map"("wix_connection_id", "wix_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_provider_evidence_webhook_id_key" ON "wix_provider_evidence"("webhook_id");

-- CreateIndex
CREATE INDEX "wix_provider_evidence_wix_connection_id_topic_received_at_idx" ON "wix_provider_evidence"("wix_connection_id", "topic", "received_at");

-- CreateIndex
CREATE INDEX "wix_provider_evidence_process_state_received_at_idx" ON "wix_provider_evidence"("process_state", "received_at");

-- CreateIndex
CREATE INDEX "wix_provider_evidence_site_id_triggered_at_idx" ON "wix_provider_evidence"("site_id", "triggered_at");

-- CreateIndex
CREATE INDEX "wix_provider_evidence_event_id_idx" ON "wix_provider_evidence"("event_id");

-- CreateIndex
CREATE INDEX "wix_order_line_sale_fact_wix_connection_id_apply_state_idx" ON "wix_order_line_sale_fact"("wix_connection_id", "apply_state");

-- CreateIndex
CREATE INDEX "wix_order_line_sale_fact_evidence_id_idx" ON "wix_order_line_sale_fact"("evidence_id");

-- CreateIndex
CREATE INDEX "wix_order_line_sale_fact_store_variant_id_idx" ON "wix_order_line_sale_fact"("store_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_order_line_sale_fact_wix_connection_id_wix_order_id_wix_key" ON "wix_order_line_sale_fact"("wix_connection_id", "wix_order_id", "wix_line_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "wix_sync_job_dedupe_key_key" ON "wix_sync_job"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "wix_sync_job_evidence_id_key" ON "wix_sync_job"("evidence_id");

-- CreateIndex
CREATE INDEX "wix_sync_job_state_next_attempt_at_idx" ON "wix_sync_job"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "wix_sync_job_lease_expires_at_idx" ON "wix_sync_job"("lease_expires_at");

-- CreateIndex
CREATE INDEX "wix_sync_job_wix_connection_id_state_idx" ON "wix_sync_job"("wix_connection_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "wix_oauth_state_nonce_key" ON "wix_oauth_state"("nonce");

-- CreateIndex
CREATE INDEX "wix_oauth_state_member_id_idx" ON "wix_oauth_state"("member_id");

-- CreateIndex
CREATE INDEX "wix_oauth_state_expires_at_idx" ON "wix_oauth_state"("expires_at");

-- AddForeignKey
ALTER TABLE "wix_connection" ADD CONSTRAINT "wix_connection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_listing_import_attempt" ADD CONSTRAINT "wix_listing_import_attempt_wix_connection_id_member_id_fkey" FOREIGN KEY ("wix_connection_id", "member_id") REFERENCES "wix_connection"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_listing_import_attempt" ADD CONSTRAINT "wix_listing_import_attempt_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_listing_link" ADD CONSTRAINT "wix_listing_link_wix_connection_id_member_id_fkey" FOREIGN KEY ("wix_connection_id", "member_id") REFERENCES "wix_connection"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_listing_link" ADD CONSTRAINT "wix_listing_link_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_listing_link" ADD CONSTRAINT "wix_listing_link_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_variant_map" ADD CONSTRAINT "wix_variant_map_wix_connection_id_member_id_fkey" FOREIGN KEY ("wix_connection_id", "member_id") REFERENCES "wix_connection"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_variant_map" ADD CONSTRAINT "wix_variant_map_wix_listing_link_id_wix_connection_id_store_fkey" FOREIGN KEY ("wix_listing_link_id", "wix_connection_id", "store_item_id") REFERENCES "wix_listing_link"("id", "wix_connection_id", "store_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_variant_map" ADD CONSTRAINT "wix_variant_map_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_provider_evidence" ADD CONSTRAINT "wix_provider_evidence_wix_connection_id_fkey" FOREIGN KEY ("wix_connection_id") REFERENCES "wix_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_order_line_sale_fact" ADD CONSTRAINT "wix_order_line_sale_fact_wix_connection_id_member_id_fkey" FOREIGN KEY ("wix_connection_id", "member_id") REFERENCES "wix_connection"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_order_line_sale_fact" ADD CONSTRAINT "wix_order_line_sale_fact_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_order_line_sale_fact" ADD CONSTRAINT "wix_order_line_sale_fact_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "wix_provider_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_sync_job" ADD CONSTRAINT "wix_sync_job_wix_connection_id_fkey" FOREIGN KEY ("wix_connection_id") REFERENCES "wix_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_sync_job" ADD CONSTRAINT "wix_sync_job_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "wix_provider_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wix_oauth_state" ADD CONSTRAINT "wix_oauth_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
