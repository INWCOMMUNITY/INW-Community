-- INW custom-option edits stay local until Etsy accepts the replace.
ALTER TABLE "etsy_listing_link"
  ADD COLUMN IF NOT EXISTS "personalization_dirty" BOOLEAN NOT NULL DEFAULT false;
