-- Seller shipping rules: combined-order cap and free shipping over a store total.
ALTER TABLE "Member"
  ADD COLUMN "combine_shipping" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "combined_shipping_max_cents" INTEGER,
  ADD COLUMN "free_shipping_minimum_cents" INTEGER;
