-- AlterTable Coupon: optional secret_key for trial/claim flows
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "secret_key" TEXT;
