-- Additive first-attempt provider snapshot for same-key entitlement replay.
-- Destination and source charge must be frozen before stripe.transfers.create.

ALTER TABLE "seller_return_entitlement_operation"
  ADD COLUMN "stripe_destination_account_id" TEXT,
  ADD COLUMN "stripe_source_charge_id" TEXT;

ALTER TABLE "seller_return_entitlement_operation"
  ADD CONSTRAINT "sreo_provider_snapshot_check" CHECK (
    "retry_count" = 0
    OR (
      "stripe_destination_account_id" IS NOT NULL
      AND "stripe_source_charge_id" IS NOT NULL
    )
  );
