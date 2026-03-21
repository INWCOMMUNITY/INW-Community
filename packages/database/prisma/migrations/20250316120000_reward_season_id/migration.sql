-- AlterTable: add optional season_id to Reward so rewards can be assigned to a season and only show when that season is current
-- Table name must match Prisma default for model Reward (PascalCase), not "reward".
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "season_id" TEXT;

-- AddForeignKey (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_season_id_fkey'
  ) THEN
    ALTER TABLE "Reward" ADD CONSTRAINT "reward_season_id_fkey"
      FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reward_season_id_idx" ON "Reward"("season_id");
