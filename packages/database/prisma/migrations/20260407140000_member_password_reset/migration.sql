ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "password_reset_token_hash" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "password_reset_expires_at" TIMESTAMP(3);
