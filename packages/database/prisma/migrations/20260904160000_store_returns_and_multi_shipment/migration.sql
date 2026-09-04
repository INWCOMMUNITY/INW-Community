-- AlterTable
ALTER TABLE "Member" ADD COLUMN "charge_return_shipping" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_order_id_key";
ALTER TABLE "Shipment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'outbound';
ALTER TABLE "Shipment" ADD COLUMN "superseded_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Shipment_order_id_kind_idx" ON "Shipment"("order_id", "kind");
CREATE INDEX "Shipment_order_id_superseded_at_idx" ON "Shipment"("order_id", "superseded_at");

-- CreateTable
CREATE TABLE "StoreReturn" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "note" TEXT,
    "require_return" BOOLEAN NOT NULL DEFAULT true,
    "charge_return_shipping" BOOLEAN NOT NULL DEFAULT false,
    "refund_amount_cents" INTEGER,
    "return_label_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "decline_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "return_shipment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreReturn_return_shipment_id_key" ON "StoreReturn"("return_shipment_id");
CREATE INDEX "StoreReturn_order_id_status_idx" ON "StoreReturn"("order_id", "status");
CREATE INDEX "StoreReturn_status_idx" ON "StoreReturn"("status");

-- AddForeignKey
ALTER TABLE "StoreReturn" ADD CONSTRAINT "StoreReturn_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreReturn" ADD CONSTRAINT "StoreReturn_return_shipment_id_fkey" FOREIGN KEY ("return_shipment_id") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
