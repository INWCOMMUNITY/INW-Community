-- Shopify Marketplace V2 S1: connection, OAuth state, generation, one active install.

CREATE TYPE "shopify_connection_status" AS ENUM ('ACTIVE', 'DISCONNECTED', 'REVOKED');

CREATE TABLE "shopify_oauth_state" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_oauth_state_nonce_key" ON "shopify_oauth_state"("nonce");
CREATE INDEX "shopify_oauth_state_member_id_shop_domain_idx" ON "shopify_oauth_state"("member_id", "shop_domain");
CREATE INDEX "shopify_oauth_state_expires_at_idx" ON "shopify_oauth_state"("expires_at");

ALTER TABLE "shopify_oauth_state" ADD CONSTRAINT "shopify_oauth_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shopify_connection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
    "granted_scopes" TEXT NOT NULL,
    "status" "shopify_connection_status" NOT NULL,
    "primary_location_id" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_connection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shopify_connection_generation_check" CHECK ("generation" >= 1)
);

CREATE UNIQUE INDEX "shopify_connection_member_id_shop_domain_generation_key" ON "shopify_connection"("member_id", "shop_domain", "generation");
CREATE INDEX "shopify_connection_member_id_status_idx" ON "shopify_connection"("member_id", "status");
CREATE INDEX "shopify_connection_shop_domain_status_idx" ON "shopify_connection"("shop_domain", "status");

-- At most one ACTIVE generation per member + normalized shop. Historical rows stay.
CREATE UNIQUE INDEX "shopify_connection_one_active_per_member_shop"
ON "shopify_connection" ("member_id", "shop_domain")
WHERE "status" = 'ACTIVE';

ALTER TABLE "shopify_connection" ADD CONSTRAINT "shopify_connection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
