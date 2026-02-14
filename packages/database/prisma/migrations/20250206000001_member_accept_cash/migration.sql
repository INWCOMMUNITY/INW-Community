-- AlterTable Member: accept cash for pickup/delivery (resale)
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "accept_cash_for_pickup_delivery" BOOLEAN NOT NULL DEFAULT true;
