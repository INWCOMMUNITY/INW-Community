-- AlterTable
ALTER TABLE "shipping_option" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'inw';
ALTER TABLE "shipping_option" ADD COLUMN IF NOT EXISTS "remote_profile_id" TEXT;
ALTER TABLE "shipping_option" ADD COLUMN IF NOT EXISTS "last_imported_at" TIMESTAMP(3);

-- CreateIndex (PostgreSQL treats NULLs as distinct, so many INW rows with NULL remote id are allowed)
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_option_member_id_source_remote_profile_id_key"
  ON "shipping_option"("member_id", "source", "remote_profile_id");
