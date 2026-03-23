# Restoring deleted businesses (operations)

This document supports recovering **`Business` rows** only (not a full test re-seed). Deleting members cascades to their businesses—see Prisma schema (`Business.memberId` → `Member`).

## 1. Prefer host backup / PITR

1. Open your PostgreSQL provider (Neon, Supabase, RDS, Vercel Postgres, etc.).
2. Find **automated backups**, **point-in-time recovery**, or a **manual snapshot** from *before* the deletion.
3. Prefer **selective restore** of `Business` (and dependent rows only if required for FK integrity) into the current database, or merge from a restored branch—avoid replacing production wholesale unless you intend a full rollback.
4. If former owners were deleted, set **`memberId`** to your admin member (`ADMIN_EMAIL` in `.env`), then reassign businesses via admin APIs or dashboard when ready.

## 2. No backup: manual / CSV

1. Maintain an authoritative list (CSV) of businesses to recreate: name, slug, address, categories, etc.
2. Recreate through the app or admin flows; attach to the admin account as needed.
3. Do **not** rely on `pnpm db:seed` alone to recreate real production businesses—seed data are fixtures.

## 3. Before future cleanups

- Export `Business` (and related) or take a snapshot.
- Avoid scripts like `delete-members-except-universal.js` against production without a fresh backup.

## Related scripts (destructive)

- [`packages/database/scripts/delete-members-except-universal.js`](packages/database/scripts/delete-members-except-universal.js) — deletes all members except `universal@nwc.local`; cascades businesses.
- Other `delete-*` scripts in the same folder — read headers before running.
