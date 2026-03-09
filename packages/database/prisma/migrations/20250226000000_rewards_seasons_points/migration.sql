-- AlterTable Member: add all_time_points_earned
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "all_time_points_earned" INTEGER NOT NULL DEFAULT 0;

-- CreateTable Season
CREATE TABLE IF NOT EXISTS "season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable MemberSeasonPoints
CREATE TABLE IF NOT EXISTS "member_season_points" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_season_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "member_season_points_member_id_season_id_key" ON "member_season_points"("member_id", "season_id");
CREATE INDEX IF NOT EXISTS "member_season_points_season_id_idx" ON "member_season_points"("season_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_season_points_member_id_fkey'
  ) THEN
    ALTER TABLE "member_season_points" ADD CONSTRAINT "member_season_points_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_season_points_season_id_fkey'
  ) THEN
    ALTER TABLE "member_season_points" ADD CONSTRAINT "member_season_points_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Add reward to SavedItemType enum (PostgreSQL) if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'SavedItemType' AND e.enumlabel = 'reward'
  ) THEN
    ALTER TYPE "SavedItemType" ADD VALUE 'reward';
  END IF;
END $$;
