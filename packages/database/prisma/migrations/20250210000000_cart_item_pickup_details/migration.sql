-- AlterTable CartItem: store pickup terms agreement and contact details
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "pickup_details" JSONB;
