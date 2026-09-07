-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN "stripe_refund_id" TEXT;
ALTER TABLE "StoreOrder" ADD COLUMN "refund_initiated_at" TIMESTAMP(3);
ALTER TABLE "StoreOrder" ADD COLUMN "refund_completed_at" TIMESTAMP(3);
