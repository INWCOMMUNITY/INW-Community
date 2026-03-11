# Run this in your **production** database

The error `The table public.member_push_token does not exist` means your **production** DB (e.g. Neon) never had the migration applied.

## Fix: run the SQL in production

1. Open your **production** database:
   - **Neon**: Dashboard → your project → **SQL Editor**
   - Or any client connected to the same `DATABASE_URL` your Vercel app uses

2. Paste and run the entire contents of **`prisma/ensure-member-push-token.sql`** (in this package).

Or copy-paste this block:

```sql
CREATE TABLE IF NOT EXISTS "member_push_token" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_push_token_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "member_block" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_push_token_token_key" ON "member_push_token"("token");
CREATE INDEX IF NOT EXISTS "member_push_token_member_id_idx" ON "member_push_token"("member_id");
CREATE UNIQUE INDEX IF NOT EXISTS "member_block_blocker_id_blocked_id_key" ON "member_block"("blocker_id", "blocked_id");
CREATE INDEX IF NOT EXISTS "member_block_blocker_id_idx" ON "member_block"("blocker_id");
CREATE INDEX IF NOT EXISTS "member_block_blocked_id_idx" ON "member_block"("blocked_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_push_token_member_id_fkey') THEN
    ALTER TABLE "member_push_token" ADD CONSTRAINT "member_push_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_block_blocker_id_fkey') THEN
    ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_block_blocked_id_fkey') THEN
    ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
```

3. Redeploy or wait for the next request — the push-token API will then work.

Until you run this, the push-token endpoint will return **503** instead of crashing (so the rest of the app stays up).

---

## If messaging fails with "server error" when starting a conversation

Your production DB may be missing the **direct_conversation** columns for message requests. Run this in Neon SQL Editor:

**File:** `prisma/ensure-direct-conversation-status.sql`

Or paste and run:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'direct_conversation' AND column_name = 'status') THEN
    ALTER TABLE "direct_conversation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'direct_conversation' AND column_name = 'requested_by_member_id') THEN
    ALTER TABLE "direct_conversation" ADD COLUMN "requested_by_member_id" TEXT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "direct_conversation_status_idx" ON "direct_conversation"("status");
```
