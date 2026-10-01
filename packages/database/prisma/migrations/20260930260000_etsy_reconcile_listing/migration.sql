-- E9: listing reconcile job kind.

ALTER TYPE "etsy_sync_job_kind" ADD VALUE IF NOT EXISTS 'RECONCILE_LISTING';
