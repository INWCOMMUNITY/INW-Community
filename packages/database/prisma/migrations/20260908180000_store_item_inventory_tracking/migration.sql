-- AlterTable
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "inventory_tracking" TEXT NOT NULL DEFAULT 'tracked';
