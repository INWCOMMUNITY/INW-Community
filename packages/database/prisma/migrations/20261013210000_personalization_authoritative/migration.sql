-- Empty INW custom options must not delete Etsy personalization until a read or seller save has confirmed them.
ALTER TABLE "etsy_listing_link" ADD COLUMN IF NOT EXISTS "personalization_authoritative" BOOLEAN NOT NULL DEFAULT true;
