-- AlterTable
ALTER TABLE "resale_conversation" ADD COLUMN "buyer_last_read_at" TIMESTAMP(3),
ADD COLUMN "seller_last_read_at" TIMESTAMP(3);

-- Existing threads: avoid treating all historical messages as unread after deploy
UPDATE "resale_conversation"
SET "buyer_last_read_at" = NOW(),
    "seller_last_read_at" = NOW();
