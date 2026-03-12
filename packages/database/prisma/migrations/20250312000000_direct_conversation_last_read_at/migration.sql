-- AlterTable
ALTER TABLE "direct_conversation" ADD COLUMN "member_a_last_read_at" TIMESTAMP(3),
ADD COLUMN "member_b_last_read_at" TIMESTAMP(3);
