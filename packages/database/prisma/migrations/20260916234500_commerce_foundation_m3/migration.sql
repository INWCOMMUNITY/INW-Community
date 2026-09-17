-- Commerce foundation M3: Stripe event evidence + refund/transfer intentions only.
-- Does not call Stripe, refund, transfer, restock inventory, or add M4.
-- RefundOperation.member_id / TransferOperation.member_id are the SELLER tenant.
-- restock_requested is policy only and does not mutate inventory.

CREATE TYPE "stripe_evidence_process_state" AS ENUM (
    'RECEIVED',
    'PROCESSED',
    'IGNORED',
    'ERROR'
);

CREATE TYPE "refund_kind" AS ENUM (
    'FULL',
    'PARTIAL',
    'COURTESY',
    'RETURN'
);

CREATE TYPE "financial_operation_status" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'UNCERTAIN'
);

CREATE TABLE "stripe_event_evidence" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "stripe_created_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT,
    "process_state" "stripe_evidence_process_state" NOT NULL DEFAULT 'RECEIVED',
    "last_error" TEXT,
    "checkout_attempt_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_event_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_event_evidence_stripe_event_id_key" ON "stripe_event_evidence"("stripe_event_id");
CREATE INDEX "stripe_event_evidence_process_state_received_at_idx" ON "stripe_event_evidence"("process_state", "received_at");

ALTER TABLE "stripe_event_evidence" ADD CONSTRAINT "stripe_event_evidence_checkout_attempt_id_fkey" FOREIGN KEY ("checkout_attempt_id") REFERENCES "checkout_attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "refund_operation" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "checkout_attempt_id" TEXT,
    "kind" "refund_kind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "restock_requested" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "provider_idempotency_key" TEXT NOT NULL,
    "stripe_refund_id" TEXT,
    "status" "financial_operation_status" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "succeeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_operation_amount_positive_check" CHECK ("amount_cents" > 0),
    CONSTRAINT "refund_operation_retry_nonnegative_check" CHECK ("retry_count" >= 0)
);

CREATE UNIQUE INDEX "refund_operation_provider_idempotency_key_key" ON "refund_operation"("provider_idempotency_key");
CREATE UNIQUE INDEX "refund_operation_stripe_refund_id_key" ON "refund_operation"("stripe_refund_id");
CREATE INDEX "refund_operation_status_created_at_idx" ON "refund_operation"("status", "created_at");

ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_checkout_attempt_id_fkey" FOREIGN KEY ("checkout_attempt_id") REFERENCES "checkout_attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_store_order_id_member_id_fkey" FOREIGN KEY ("store_order_id", "member_id") REFERENCES "StoreOrder"("id", "seller_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_order_item_id_store_order_id_fkey" FOREIGN KEY ("order_item_id", "store_order_id") REFERENCES "OrderItem"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_operation" ADD CONSTRAINT "refund_operation_store_order_id_checkout_attempt_id_fkey" FOREIGN KEY ("store_order_id", "checkout_attempt_id") REFERENCES "StoreOrder"("id", "checkout_attempt_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transfer_operation" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_order_id" TEXT NOT NULL,
    "provider_idempotency_key" TEXT NOT NULL,
    "stripe_transfer_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "financial_operation_status" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "succeeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transfer_operation_amount_positive_check" CHECK ("amount_cents" > 0),
    CONSTRAINT "transfer_operation_retry_nonnegative_check" CHECK ("retry_count" >= 0)
);

CREATE UNIQUE INDEX "transfer_operation_store_order_id_key" ON "transfer_operation"("store_order_id");
CREATE UNIQUE INDEX "transfer_operation_provider_idempotency_key_key" ON "transfer_operation"("provider_idempotency_key");
CREATE UNIQUE INDEX "transfer_operation_stripe_transfer_id_key" ON "transfer_operation"("stripe_transfer_id");
CREATE INDEX "transfer_operation_status_created_at_idx" ON "transfer_operation"("status", "created_at");

ALTER TABLE "transfer_operation" ADD CONSTRAINT "transfer_operation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_operation" ADD CONSTRAINT "transfer_operation_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_operation" ADD CONSTRAINT "transfer_operation_store_order_id_member_id_fkey" FOREIGN KEY ("store_order_id", "member_id") REFERENCES "StoreOrder"("id", "seller_id") ON DELETE RESTRICT ON UPDATE CASCADE;
