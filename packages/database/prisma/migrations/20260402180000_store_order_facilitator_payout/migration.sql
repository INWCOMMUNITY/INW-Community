-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "sales_tax_reserve_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "platform_fee_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "stripe_seller_transfer_id" TEXT;
