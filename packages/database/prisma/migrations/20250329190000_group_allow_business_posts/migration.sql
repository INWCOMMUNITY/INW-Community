-- AlterTable
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "allow_business_posts" BOOLEAN NOT NULL DEFAULT false;
