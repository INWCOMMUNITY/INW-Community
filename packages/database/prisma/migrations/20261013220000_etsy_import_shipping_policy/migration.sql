-- Bulk Etsy import: copy a domestic shipping price, or ship free on INW.
CREATE TYPE "etsy_import_shipping_policy" AS ENUM ('IMPORT_PRICES', 'FREE');

ALTER TABLE "etsy_import_batch"
  ADD COLUMN "shipping_policy" "etsy_import_shipping_policy" NOT NULL DEFAULT 'FREE';
