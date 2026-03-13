-- Replace EasyPost with Shippo: drop EasyPost columns, add Shippo columns.
-- Sellers must reconnect Shippo and add at least one address in their Shippo account.

-- Member: add Shippo key column
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "shippo_api_key_encrypted" TEXT;

-- Member: drop EasyPost columns
ALTER TABLE "Member" DROP COLUMN IF EXISTS "easypost_referral_customer_id";
ALTER TABLE "Member" DROP COLUMN IF EXISTS "easypost_api_key_encrypted";
ALTER TABLE "Member" DROP COLUMN IF EXISTS "easypost_return_address";
ALTER TABLE "Member" DROP COLUMN IF EXISTS "easypost_sender_address_id";

-- Shipment: add Shippo transaction id
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "shippo_transaction_id" TEXT;

-- Shipment: drop EasyPost column
ALTER TABLE "Shipment" DROP COLUMN IF EXISTS "easypost_shipment_id";
