-- Buyer custom options (text, dropdown, file). Not inventory variations.

DO $$ BEGIN
  CREATE TYPE "listing_buyer_field_kind" AS ENUM ('TEXT', 'DROPDOWN', 'FILE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "listing_buyer_field" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "listing_buyer_field_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_characters" INTEGER,
    "max_files" INTEGER,
    "label_each_file" BOOLEAN NOT NULL DEFAULT false,
    "etsy_question_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_buyer_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "listing_buyer_field_option" (
    "id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "etsy_option_id" TEXT,

    CONSTRAINT "listing_buyer_field_option_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "listing_buyer_field_store_item_id_position_key"
  ON "listing_buyer_field"("store_item_id", "position");
CREATE INDEX IF NOT EXISTS "listing_buyer_field_store_item_id_idx"
  ON "listing_buyer_field"("store_item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "listing_buyer_field_option_field_id_position_key"
  ON "listing_buyer_field_option"("field_id", "position");
CREATE INDEX IF NOT EXISTS "listing_buyer_field_option_field_id_idx"
  ON "listing_buyer_field_option"("field_id");

DO $$ BEGIN
  ALTER TABLE "listing_buyer_field"
    ADD CONSTRAINT "listing_buyer_field_store_item_id_fkey"
    FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "listing_buyer_field_option"
    ADD CONSTRAINT "listing_buyer_field_option_field_id_fkey"
    FOREIGN KEY ("field_id") REFERENCES "listing_buyer_field"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "buyer_responses" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "buyer_responses" JSONB;
ALTER TABLE "etsy_order_line_sale_fact" ADD COLUMN IF NOT EXISTS "personalization_json" JSONB;
