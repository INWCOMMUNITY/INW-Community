-- Add counter offer support for resale (eBay-style)
ALTER TABLE "resale_offer" ADD COLUMN IF NOT EXISTS "counter_amount_cents" INTEGER;
