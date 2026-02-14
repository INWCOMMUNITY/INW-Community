-- AlterTable: Business - add categories, migrate from category, drop category
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "categories" TEXT[] NOT NULL DEFAULT '{}';

-- Migrate existing category data to categories array
UPDATE "Business" SET "categories" = ARRAY["category"]::TEXT[] WHERE "category" IS NOT NULL AND "category" != '';

ALTER TABLE "Business" DROP COLUMN IF EXISTS "category";

-- AlterTable: Event - add endTime
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "end_time" TEXT;
