-- Additive seller-return entitlement operation. Does not mutate M1/M2/M3.
-- Supporting unique on StoreReturn(id, order_id) exists only for the composite return/order FK.

CREATE UNIQUE INDEX "StoreReturn_id_order_id_key" ON "StoreReturn"("id", "order_id");

CREATE TABLE "seller_return_entitlement_operation" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_order_id" TEXT NOT NULL,
    "store_return_id" TEXT NOT NULL,
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

    CONSTRAINT "seller_return_entitlement_operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sreo_amount_positive_check" CHECK ("amount_cents" > 0),
    CONSTRAINT "sreo_retry_nonnegative_check" CHECK ("retry_count" >= 0)
);

CREATE UNIQUE INDEX "sreo_store_order_id_key" ON "seller_return_entitlement_operation"("store_order_id");
CREATE UNIQUE INDEX "sreo_store_return_id_key" ON "seller_return_entitlement_operation"("store_return_id");
CREATE UNIQUE INDEX "sreo_provider_idempotency_key_key" ON "seller_return_entitlement_operation"("provider_idempotency_key");
CREATE UNIQUE INDEX "sreo_stripe_transfer_id_key" ON "seller_return_entitlement_operation"("stripe_transfer_id");
CREATE INDEX "sreo_status_created_at_idx" ON "seller_return_entitlement_operation"("status", "created_at");

ALTER TABLE "seller_return_entitlement_operation" ADD CONSTRAINT "sreo_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_return_entitlement_operation" ADD CONSTRAINT "sreo_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_return_entitlement_operation" ADD CONSTRAINT "sreo_store_return_id_fkey" FOREIGN KEY ("store_return_id") REFERENCES "StoreReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_return_entitlement_operation" ADD CONSTRAINT "sreo_store_order_id_member_id_fkey" FOREIGN KEY ("store_order_id", "member_id") REFERENCES "StoreOrder"("id", "seller_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_return_entitlement_operation" ADD CONSTRAINT "sreo_store_return_id_store_order_id_fkey" FOREIGN KEY ("store_return_id", "store_order_id") REFERENCES "StoreReturn"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
