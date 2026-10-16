-- Seller must choose whether a canceled or returned line goes back on the listing.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stock_return_decision" TEXT;
