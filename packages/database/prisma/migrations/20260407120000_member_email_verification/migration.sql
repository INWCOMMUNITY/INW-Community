-- Email verification for new member signups (existing rows grandfathered below).

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "email_verification_token_hash" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "email_verification_expires_at" TIMESTAMP(3);

-- Grandfather legacy rows only (new signups set a verification token; do not touch those).
UPDATE "Member" SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL AND "email_verification_token_hash" IS NULL;
