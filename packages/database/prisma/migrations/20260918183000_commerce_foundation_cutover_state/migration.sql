-- Commerce foundation cutover singleton. Schema + initial LEGACY row only.
-- No StoreItem / Variant / inventory / Member / marketplace DML.

CREATE TYPE "commerce_foundation_cutover_mode" AS ENUM (
    'LEGACY',
    'FROZEN',
    'BACKFILLING',
    'FOUNDATION',
    'UNFROZEN'
);

CREATE TABLE "commerce_foundation_cutover" (
    "id" TEXT NOT NULL,
    "mode" "commerce_foundation_cutover_mode" NOT NULL DEFAULT 'LEGACY',
    "frozen_at" TIMESTAMP(3),
    "backfilled_at" TIMESTAMP(3),
    "foundation_at" TIMESTAMP(3),
    "unfrozen_at" TIMESTAMP(3),
    "engine_sha" TEXT,
    "manifest_hash" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_foundation_cutover_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commerce_foundation_cutover_singleton_id_check" CHECK ("id" = 'singleton')
);

INSERT INTO "commerce_foundation_cutover" ("id", "mode", "updated_at")
VALUES ('singleton', 'LEGACY', CURRENT_TIMESTAMP);
