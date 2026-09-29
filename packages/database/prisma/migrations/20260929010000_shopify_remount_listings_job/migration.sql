-- Remount prior-generation NATIVE mappings onto a new ACTIVE connection for the same shop.

ALTER TYPE "shopify_sync_job_kind" ADD VALUE 'REMOUNT_LISTINGS';
