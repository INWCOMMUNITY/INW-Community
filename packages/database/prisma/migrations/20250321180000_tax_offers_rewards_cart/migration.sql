-- StoreOrder: tax + order kind (reward vs storefront)
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "tax_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "order_kind" TEXT NOT NULL DEFAULT 'storefront';

-- CartItem: locked offer price + link to accepted offer
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "price_override_cents" INTEGER;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resale_offer_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_resale_offer_id_key" ON "CartItem"("resale_offer_id") WHERE "resale_offer_id" IS NOT NULL;

-- ResaleOffer: checkout window after accept
ALTER TABLE "resale_offer" ADD COLUMN IF NOT EXISTS "final_amount_cents" INTEGER;
ALTER TABLE "resale_offer" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3);
ALTER TABLE "resale_offer" ADD COLUMN IF NOT EXISTS "checkout_deadline_at" TIMESTAMP(3);

-- Reward: shipping fulfillment flag
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "needs_shipping" BOOLEAN NOT NULL DEFAULT false;

-- RewardRedemption: link to order + business contact snapshot
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "store_order_id" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "fulfillment_status" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RewardRedemption_store_order_id_key" ON "RewardRedemption"("store_order_id") WHERE "store_order_id" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CartItem_resale_offer_id_fkey'
  ) THEN
    ALTER TABLE "CartItem"
      ADD CONSTRAINT "CartItem_resale_offer_id_fkey"
      FOREIGN KEY ("resale_offer_id") REFERENCES "resale_offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
