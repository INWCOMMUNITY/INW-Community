-- S1 identity repair: browser-binding hash and one global ACTIVE owner per shop.

ALTER TABLE "shopify_oauth_state" ADD COLUMN "browser_binding_hash" VARCHAR(64) NOT NULL;

CREATE UNIQUE INDEX "shopify_connection_one_active_shop_domain"
ON "shopify_connection" ("shop_domain")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "shopify_connection_one_active_shop_id"
ON "shopify_connection" ("shop_id")
WHERE "status" = 'ACTIVE';
