-- Optional subcategories aligned by index with categories (same length when used).
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "subcategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
