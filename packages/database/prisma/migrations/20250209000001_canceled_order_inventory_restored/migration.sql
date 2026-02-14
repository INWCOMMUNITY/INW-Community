-- AlterTable StoreOrder: track when seller re-lists items from a canceled cash order
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "inventory_restored_at" TIMESTAMP(3);
