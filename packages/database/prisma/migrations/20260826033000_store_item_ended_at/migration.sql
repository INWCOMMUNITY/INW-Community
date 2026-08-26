-- AlterTable
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3);

-- Backfill: treat existing ended (inactive) listings as ended at last update.
UPDATE "StoreItem"
SET "ended_at" = "updated_at"
WHERE "status" = 'inactive' AND "ended_at" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoreItem_status_endedAt_idx" ON "StoreItem"("status", "ended_at");
