-- Track last successful password reset (forgot-password flow) to enforce cooldown between reset emails.

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "password_reset_completed_at" TIMESTAMP(3);
