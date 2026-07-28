-- CreateTable
CREATE TABLE "price_drop_alert" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "target_price_cents" INTEGER,
    "original_price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggered_at" TIMESTAMP(3),

    CONSTRAINT "price_drop_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_drop_alert_store_item_id_active_idx" ON "price_drop_alert"("store_item_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "price_drop_alert_member_id_store_item_id_key" ON "price_drop_alert"("member_id", "store_item_id");

-- AddForeignKey
ALTER TABLE "price_drop_alert" ADD CONSTRAINT "price_drop_alert_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drop_alert" ADD CONSTRAINT "price_drop_alert_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
