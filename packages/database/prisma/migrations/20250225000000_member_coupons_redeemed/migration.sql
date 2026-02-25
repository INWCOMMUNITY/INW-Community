-- AlterTable Member: coupons_redeemed (for Penny Pusher badge / coupon redemption count)
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "coupons_redeemed" INTEGER NOT NULL DEFAULT 0;
