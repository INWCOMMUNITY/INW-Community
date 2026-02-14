-- AlterTable Member: add phone, delivery_address (private, for orders/deliveries)
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "delivery_address" JSONB;

-- AlterTable CartItem: fulfillment type and local delivery details
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "fulfillment_type" TEXT;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "local_delivery_details" JSONB;

-- AlterTable StoreItem: local delivery fee, in-store pickup, shipping disabled
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "local_delivery_fee_cents" INTEGER;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "in_store_pickup_available" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "shipping_disabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable StoreOrder: local delivery details and delivery confirmed
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "local_delivery_details" JSONB;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "delivery_confirmed_at" TIMESTAMP(3);

-- AlterTable OrderItem: fulfillment type
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "fulfillment_type" TEXT;
