-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "delivery_buyer_confirmed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pickup_seller_confirmed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pickup_buyer_confirmed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "pickup_details" JSONB;
