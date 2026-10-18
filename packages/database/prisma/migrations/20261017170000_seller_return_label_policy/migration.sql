ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "handling_time" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "return_label_payer" TEXT;
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "return_label_payer_by_reason" JSONB;
