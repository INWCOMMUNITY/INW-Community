-- Add cancel reason and note for buyer cancellations/refunds
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "cancel_note" TEXT;
