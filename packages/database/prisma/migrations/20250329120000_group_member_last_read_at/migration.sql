-- Per-member read cursor for group inbox unread counts
ALTER TABLE "group_conversation_member" ADD COLUMN "last_read_at" TIMESTAMP(3);
UPDATE "group_conversation_member" SET "last_read_at" = NOW() WHERE "last_read_at" IS NULL;
