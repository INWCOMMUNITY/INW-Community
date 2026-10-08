-- Drop the Wix store connection. Inventory, store items, and Wix-hosted image URLs stay.

DROP TABLE IF EXISTS "wix_sync_job";
DROP TABLE IF EXISTS "wix_order_line_sale_fact";
DROP TABLE IF EXISTS "wix_variant_map";
DROP TABLE IF EXISTS "wix_listing_import_attempt";
DROP TABLE IF EXISTS "wix_provider_evidence";
DROP TABLE IF EXISTS "wix_listing_link";
DROP TABLE IF EXISTS "wix_oauth_state";
DROP TABLE IF EXISTS "wix_connection";

DROP TYPE IF EXISTS "wix_order_line_sale_apply_state";
DROP TYPE IF EXISTS "wix_sync_job_kind";
DROP TYPE IF EXISTS "wix_sync_job_state";
DROP TYPE IF EXISTS "wix_evidence_process_state";
DROP TYPE IF EXISTS "wix_capability_health";
DROP TYPE IF EXISTS "wix_listing_readiness";
DROP TYPE IF EXISTS "wix_listing_import_attempt_status";
DROP TYPE IF EXISTS "wix_listing_import_source";
DROP TYPE IF EXISTS "wix_catalog_version";
DROP TYPE IF EXISTS "wix_connection_status";
