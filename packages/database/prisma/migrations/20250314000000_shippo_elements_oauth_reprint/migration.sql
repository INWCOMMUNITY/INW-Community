-- Shippo Elements: OAuth token for "Connect with Shippo", and Shippo order id for re-print in widget.

-- Member: store OAuth Bearer token from Shippo OAuth flow
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "shippo_oauth_token_encrypted" TEXT;

-- Shipment: store Shippo order id from ORDER_CREATED so we can open same order in Elements for re-print
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "shippo_order_id" TEXT;
