-- Multiple subs per primary (JSON map). Migrate legacy parallel subcategories[] then drop column.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "subcategories_by_primary" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "Business" b
SET "subcategories_by_primary" = (
  SELECT COALESCE(
    jsonb_object_agg(primary_label, subs_json),
    '{}'::jsonb
  )
  FROM (
    SELECT
      trim(c) AS primary_label,
      COALESCE(
        to_jsonb(array_agg(trim(s)) FILTER (WHERE trim(s) IS NOT NULL AND trim(s) <> '')),
        '[]'::jsonb
      ) AS subs_json
    FROM unnest(b.categories, COALESCE(b.subcategories, ARRAY[]::text[])) AS u(c, s)
    WHERE trim(c) IS NOT NULL AND trim(c) <> ''
    GROUP BY trim(c)
  ) x
);

ALTER TABLE "Business" DROP COLUMN IF EXISTS "subcategories";
