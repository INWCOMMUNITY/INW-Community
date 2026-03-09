-- AlterTable: add status and requestedByMemberId to direct_conversation for message requests
ALTER TABLE "direct_conversation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE "direct_conversation" ADD COLUMN "requested_by_member_id" TEXT;

CREATE INDEX "direct_conversation_status_idx" ON "direct_conversation"("status");
