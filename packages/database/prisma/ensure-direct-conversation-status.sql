-- Adds status and requested_by_member_id to direct_conversation if missing (message requests).
-- Run in Neon SQL Editor if you get server errors when starting a conversation.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'direct_conversation' AND column_name = 'status'
  ) THEN
    ALTER TABLE "direct_conversation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'accepted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'direct_conversation' AND column_name = 'requested_by_member_id'
  ) THEN
    ALTER TABLE "direct_conversation" ADD COLUMN "requested_by_member_id" TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "direct_conversation_status_idx" ON "direct_conversation"("status");
