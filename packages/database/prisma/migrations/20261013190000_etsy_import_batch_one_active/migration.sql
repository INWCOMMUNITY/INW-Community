-- At most one PENDING/RUNNING Etsy import batch per connection.
CREATE UNIQUE INDEX IF NOT EXISTS "etsy_import_batch_one_active_per_connection_idx"
  ON "etsy_import_batch" ("etsy_connection_id")
  WHERE "state" IN ('PENDING', 'RUNNING');
