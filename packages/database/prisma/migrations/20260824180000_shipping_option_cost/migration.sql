-- Flat INW / domestic shipping price on package templates
ALTER TABLE "shipping_option" ADD COLUMN IF NOT EXISTS "shipping_cost_cents" INTEGER;
