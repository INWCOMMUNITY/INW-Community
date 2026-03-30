-- Repair: `member_badge_progress` is required by MemberBadgeProgress; some DBs never received it
-- (or drifted). Safe on databases that already have the table from 20250101000000_init.

CREATE TABLE IF NOT EXISTS "member_badge_progress" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "progress_key" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_badge_progress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "member_badge_progress_member_id_idx" ON "member_badge_progress"("member_id");

CREATE UNIQUE INDEX IF NOT EXISTS "member_badge_progress_member_id_progress_key_key" ON "member_badge_progress"("member_id", "progress_key");

DO $$
BEGIN
    ALTER TABLE "member_badge_progress"
    ADD CONSTRAINT "member_badge_progress_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
