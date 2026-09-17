-- Commerce foundation M2: CheckoutAttempt + InventoryReservation persistence only.
-- Does not create attempts/reservations, change checkout/Stripe writers, or add M3 money tables.
--
-- Reservation.member_id is the SELLER inventory tenant (Variant owner), not the buyer.
-- StoreOrder.commerce_status DEFAULT PENDING is compatibility for existing rows, not
-- proof those orders used the reservation protocol.
--
-- UNIQUE(order_item_id) is the one-reservation-per-line constraint.
-- UNIQUE(checkout_attempt_id, order_item_id) is omitted as redundant.

-- CreateEnum
CREATE TYPE "checkout_attempt_state" AS ENUM (
    'CREATED',
    'SESSION_OPEN',
    'SESSION_FAILED',
    'SESSION_UNKNOWN',
    'PAID',
    'CLOSED'
);

CREATE TYPE "checkout_payment_status" AS ENUM (
    'UNPAID',
    'PAID',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'FAILED'
);

CREATE TYPE "commerce_status" AS ENUM (
    'PENDING',
    'FINALIZED',
    'UNFULFILLABLE',
    'REFUND_REQUIRED'
);

-- CreateTable
CREATE TABLE "checkout_attempt" (
    "id" TEXT NOT NULL,
    "buyer_member_id" TEXT NOT NULL,
    "state" "checkout_attempt_state" NOT NULL DEFAULT 'CREATED',
    "cart_hash" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripe_idempotency_key" TEXT NOT NULL,
    "stripe_checkout_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "payment_status" "checkout_payment_status" NOT NULL DEFAULT 'UNPAID',
    "expires_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checkout_attempt_stripe_idempotency_key_key" ON "checkout_attempt"("stripe_idempotency_key");
CREATE UNIQUE INDEX "checkout_attempt_stripe_checkout_session_id_key" ON "checkout_attempt"("stripe_checkout_session_id");
CREATE UNIQUE INDEX "checkout_attempt_stripe_payment_intent_id_key" ON "checkout_attempt"("stripe_payment_intent_id");
CREATE INDEX "checkout_attempt_buyer_member_id_created_at_idx" ON "checkout_attempt"("buyer_member_id", "created_at");
CREATE INDEX "checkout_attempt_state_idx" ON "checkout_attempt"("state");

ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_buyer_member_id_fkey" FOREIGN KEY ("buyer_member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- StoreOrder additive columns. Existing rows: attempt NULL, commerce_status PENDING.
ALTER TABLE "StoreOrder" ADD COLUMN "checkout_attempt_id" TEXT;
ALTER TABLE "StoreOrder" ADD COLUMN "commerce_status" "commerce_status" NOT NULL DEFAULT 'PENDING';

CREATE UNIQUE INDEX "StoreOrder_id_checkout_attempt_id_key" ON "StoreOrder"("id", "checkout_attempt_id");
CREATE UNIQUE INDEX "StoreOrder_id_seller_id_key" ON "StoreOrder"("id", "seller_id");
CREATE INDEX "StoreOrder_checkout_attempt_id_idx" ON "StoreOrder"("checkout_attempt_id");

ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_checkout_attempt_id_fkey" FOREIGN KEY ("checkout_attempt_id") REFERENCES "checkout_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite unique keys so Reservation can FK exact OrderItem/order/listing/variant tuples.
CREATE UNIQUE INDEX "OrderItem_id_order_id_key" ON "OrderItem"("id", "order_id");
CREATE UNIQUE INDEX "OrderItem_id_store_item_id_key" ON "OrderItem"("id", "store_item_id");
CREATE UNIQUE INDEX "OrderItem_id_variant_id_store_item_id_key" ON "OrderItem"("id", "variant_id", "store_item_id");

-- CreateTable
CREATE TABLE "inventory_reservation" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "checkout_attempt_id" TEXT NOT NULL,
    "store_order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "original_qty" INTEGER NOT NULL,
    "active_qty" INTEGER NOT NULL,
    "converted_qty" INTEGER NOT NULL,
    "released_qty" INTEGER NOT NULL,
    "invalidated_qty" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_reservation_qty_check" CHECK (
        "original_qty" > 0
        AND "active_qty" >= 0
        AND "converted_qty" >= 0
        AND "released_qty" >= 0
        AND "invalidated_qty" >= 0
        AND "original_qty" = "active_qty" + "converted_qty" + "released_qty" + "invalidated_qty"
    )
);

CREATE UNIQUE INDEX "inventory_reservation_order_item_id_key" ON "inventory_reservation"("order_item_id");
CREATE INDEX "inventory_reservation_active_expires_at_idx" ON "inventory_reservation"("expires_at") WHERE "active_qty" > 0;

ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_checkout_attempt_id_fkey" FOREIGN KEY ("checkout_attempt_id") REFERENCES "checkout_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "StoreOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_store_item_id_member_id_fkey" FOREIGN KEY ("store_item_id", "member_id") REFERENCES "StoreItem"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_variant_id_store_item_id_member_id_fkey" FOREIGN KEY ("variant_id", "store_item_id", "member_id") REFERENCES "store_variant"("id", "store_item_id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_store_order_id_checkout_attempt_id_fkey" FOREIGN KEY ("store_order_id", "checkout_attempt_id") REFERENCES "StoreOrder"("id", "checkout_attempt_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_store_order_id_member_id_fkey" FOREIGN KEY ("store_order_id", "member_id") REFERENCES "StoreOrder"("id", "seller_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_item_id_store_order_id_fkey" FOREIGN KEY ("order_item_id", "store_order_id") REFERENCES "OrderItem"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_item_id_store_item_id_fkey" FOREIGN KEY ("order_item_id", "store_item_id") REFERENCES "OrderItem"("id", "store_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_line_variant_listing_fkey" FOREIGN KEY ("order_item_id", "variant_id", "store_item_id") REFERENCES "OrderItem"("id", "variant_id", "store_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryEvent may name its reservation. RESTRICT: reservations with causal history are retained.
ALTER TABLE "inventory_event" ADD COLUMN "reservation_id" TEXT;
CREATE INDEX "inventory_event_reservation_id_idx" ON "inventory_event"("reservation_id");
ALTER TABLE "inventory_event" ADD CONSTRAINT "inventory_event_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
