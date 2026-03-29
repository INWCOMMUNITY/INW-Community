-- Reward redemption: contact snapshot and notes for business-facing list
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "contact_name" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "notes_to_business" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "shipping_address" JSONB;
