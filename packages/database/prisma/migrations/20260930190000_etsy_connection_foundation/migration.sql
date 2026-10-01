-- Etsy Marketplace V2 E1: connection, OAuth state (PKCE), generation, one active install.

CREATE TYPE "etsy_connection_status" AS ENUM ('ACTIVE', 'DISCONNECTED', 'REVOKED');

CREATE TABLE "etsy_oauth_state" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "browser_binding_hash" VARCHAR(64) NOT NULL,
    "code_verifier_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etsy_oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "etsy_oauth_state_nonce_key" ON "etsy_oauth_state"("nonce");
CREATE INDEX "etsy_oauth_state_member_id_idx" ON "etsy_oauth_state"("member_id");
CREATE INDEX "etsy_oauth_state_expires_at_idx" ON "etsy_oauth_state"("expires_at");

ALTER TABLE "etsy_oauth_state" ADD CONSTRAINT "etsy_oauth_state_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "etsy_connection" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "etsy_user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "shop_name" TEXT,
    "generation" INTEGER NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
    "granted_scopes" TEXT NOT NULL,
    "status" "etsy_connection_status" NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etsy_connection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "etsy_connection_generation_check" CHECK ("generation" >= 1)
);

CREATE UNIQUE INDEX "etsy_connection_id_member_id_key" ON "etsy_connection"("id", "member_id");
CREATE UNIQUE INDEX "etsy_connection_member_id_shop_id_generation_key" ON "etsy_connection"("member_id", "shop_id", "generation");
CREATE INDEX "etsy_connection_member_id_status_idx" ON "etsy_connection"("member_id", "status");
CREATE INDEX "etsy_connection_shop_id_status_idx" ON "etsy_connection"("shop_id", "status");
CREATE INDEX "etsy_connection_etsy_user_id_status_idx" ON "etsy_connection"("etsy_user_id", "status");

-- At most one ACTIVE generation per member + shop. Historical rows stay.
CREATE UNIQUE INDEX "etsy_connection_one_active_per_member_shop"
ON "etsy_connection" ("member_id", "shop_id")
WHERE "status" = 'ACTIVE';

-- Global ownership: one ACTIVE owner per Etsy shop / user.
CREATE UNIQUE INDEX "etsy_connection_one_active_shop_id"
ON "etsy_connection" ("shop_id")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "etsy_connection_one_active_etsy_user_id"
ON "etsy_connection" ("etsy_user_id")
WHERE "status" = 'ACTIVE';

ALTER TABLE "etsy_connection" ADD CONSTRAINT "etsy_connection_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
