-- Six-digit email verification codes (hashed); legacy link tokens remain on email_verification_token_hash.

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "email_verification_code_hash" TEXT;
