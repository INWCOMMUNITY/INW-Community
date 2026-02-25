-- AlterTable Coupon: max_monthly_uses (default 1)
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "max_monthly_uses" INTEGER NOT NULL DEFAULT 1;
