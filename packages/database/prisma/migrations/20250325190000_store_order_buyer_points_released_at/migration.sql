-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "buyer_points_released_at" TIMESTAMP(3);
