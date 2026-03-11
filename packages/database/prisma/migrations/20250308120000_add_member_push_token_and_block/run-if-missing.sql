-- Run this on the database that shows "member_push_token does not exist"
-- (e.g. production/Neon). Safe to run: uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "member_push_token" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_push_token_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "member_block" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_push_token_token_key" ON "member_push_token"("token");
CREATE INDEX IF NOT EXISTS "member_push_token_member_id_idx" ON "member_push_token"("member_id");
CREATE UNIQUE INDEX IF NOT EXISTS "member_block_blocker_id_blocked_id_key" ON "member_block"("blocker_id", "blocked_id");
CREATE INDEX IF NOT EXISTS "member_block_blocker_id_idx" ON "member_block"("blocker_id");
CREATE INDEX IF NOT EXISTS "member_block_blocked_id_idx" ON "member_block"("blocked_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_push_token_member_id_fkey') THEN
    ALTER TABLE "member_push_token" ADD CONSTRAINT "member_push_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_block_blocker_id_fkey') THEN
    ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_block_blocked_id_fkey') THEN
    ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
