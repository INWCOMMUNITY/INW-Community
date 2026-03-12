-- Add EasyPost return address (used only for shipping labels and packing slips)
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "easypost_return_address" JSONB;
