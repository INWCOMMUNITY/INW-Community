-- CreateTable
CREATE TABLE "sync_trace" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "sku" TEXT,
    "category_id" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_snapshot" JSONB,
    "validation_result" JSONB,
    "transform_trace" JSONB,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "http_status" INTEGER,
    "error_code" TEXT,
    "error_category" TEXT,
    "error_message" TEXT,
    "root_cause" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_trace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_trace_member_id_provider_created_at_idx" ON "sync_trace"("member_id", "provider", "created_at");

-- CreateIndex
CREATE INDEX "sync_trace_store_item_id_created_at_idx" ON "sync_trace"("store_item_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_trace_error_code_created_at_idx" ON "sync_trace"("error_code", "created_at");

-- CreateIndex
CREATE INDEX "sync_trace_error_category_created_at_idx" ON "sync_trace"("error_category", "created_at");
