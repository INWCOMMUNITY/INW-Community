-- Bulk Shopify product import batches + IMPORT_BATCH sync job kind.

ALTER TYPE "shopify_sync_job_kind" ADD VALUE IF NOT EXISTS 'IMPORT_BATCH';

DO $$ BEGIN
  CREATE TYPE "shopify_import_batch_state" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "shopify_import_stock_mode_policy" AS ENUM ('RECOMMENDED', 'PHYSICAL', 'MADE_TO_ORDER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "shopify_import_batch" (
    "id" TEXT NOT NULL,
    "shopify_connection_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "state" "shopify_import_batch_state" NOT NULL DEFAULT 'PENDING',
    "stock_mode_policy" "shopify_import_stock_mode_policy" NOT NULL DEFAULT 'RECOMMENDED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "discover_cursor" TEXT,
    "discover_complete" BOOLEAN NOT NULL DEFAULT false,
    "queue_json" JSONB NOT NULL DEFAULT '[]',
    "failures_json" JSONB NOT NULL DEFAULT '[]',
    "avg_item_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_progress_at" TIMESTAMP(3),
    "last_error" TEXT,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_import_batch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shopify_import_batch_member_id_created_at_idx"
  ON "shopify_import_batch"("member_id", "created_at");

CREATE INDEX IF NOT EXISTS "shopify_import_batch_shopify_connection_id_state_idx"
  ON "shopify_import_batch"("shopify_connection_id", "state");

CREATE UNIQUE INDEX IF NOT EXISTS "shopify_import_batch_one_active_per_connection_idx"
  ON "shopify_import_batch" ("shopify_connection_id")
  WHERE "state" IN ('PENDING', 'RUNNING');

DO $$ BEGIN
  ALTER TABLE "shopify_import_batch"
    ADD CONSTRAINT "shopify_import_batch_shopify_connection_id_member_id_fkey"
    FOREIGN KEY ("shopify_connection_id", "member_id")
    REFERENCES "shopify_connection"("id", "member_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "shopify_import_batch"
    ADD CONSTRAINT "shopify_import_batch_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "Member"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
