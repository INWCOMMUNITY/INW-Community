-- Feed post reactions (Support / like types: leaf, love, laugh, support, insightful).
-- Schema had reaction on PostLike but no migration was applied to production.
ALTER TABLE "PostLike" ADD COLUMN IF NOT EXISTS "reaction" TEXT NOT NULL DEFAULT 'leaf';
