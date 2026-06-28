-- Item specifics / product aspects for store items (eBay item specifics two-way sync).
-- Shape: [{ "name": "Brand", "value": "Nike" }, ...]. Ignored by Etsy/Wix/Shopify.

ALTER TABLE "StoreItem" ADD COLUMN "aspects" JSONB;
