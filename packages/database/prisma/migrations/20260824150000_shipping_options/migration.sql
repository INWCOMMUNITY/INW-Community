-- Member shop preference: default new INW listings to free shipping
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "offer_free_shipping_on_inw" BOOLEAN NOT NULL DEFAULT false;

-- Import toggles (default off so we do not surprise-create options)
ALTER TABLE "member_sync_preferences" ADD COLUMN IF NOT EXISTS "import_ebay_shipping_options" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "member_sync_preferences" ADD COLUMN IF NOT EXISTS "import_etsy_shipping_options" BOOLEAN NOT NULL DEFAULT false;

-- Reusable package templates
CREATE TABLE IF NOT EXISTS "shipping_option" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "length_in" DOUBLE PRECISION,
    "width_in" DOUBLE PRECISION,
    "height_in" DOUBLE PRECISION,
    "weight_oz" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'inw',
    "remote_profile_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "last_imported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_option_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipping_option_member_id_source_remote_profile_id_key"
  ON "shipping_option"("member_id", "source", "remote_profile_id");
CREATE INDEX IF NOT EXISTS "shipping_option_member_id_archived_at_idx"
  ON "shipping_option"("member_id", "archived_at");

DO $$ BEGIN
    ALTER TABLE "shipping_option" ADD CONSTRAINT "shipping_option_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "shipping_option_id" TEXT;
CREATE INDEX IF NOT EXISTS "StoreItem_shipping_option_id_idx" ON "StoreItem"("shipping_option_id");
DO $$ BEGIN
    ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_shipping_option_id_fkey"
      FOREIGN KEY ("shipping_option_id") REFERENCES "shipping_option"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "listing_template" ADD COLUMN IF NOT EXISTS "shipping_option_id" TEXT;
DO $$ BEGIN
    ALTER TABLE "listing_template" ADD CONSTRAINT "listing_template_shipping_option_id_fkey"
      FOREIGN KEY ("shipping_option_id") REFERENCES "shipping_option"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
