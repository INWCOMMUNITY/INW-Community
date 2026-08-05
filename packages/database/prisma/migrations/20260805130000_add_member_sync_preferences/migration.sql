-- Member Sync Preferences: User-configurable sync rules for multi-platform channel sync

-- CreateTable: MemberSyncPreferences
CREATE TABLE IF NOT EXISTS "member_sync_preferences" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "source_of_truth" TEXT NOT NULL DEFAULT 'inw',
    "conflict_resolution" TEXT NOT NULL DEFAULT 'most_recent',
    "safety_buffer" INTEGER NOT NULL DEFAULT 0,
    "low_stock_alert_threshold" INTEGER NOT NULL DEFAULT 0,
    "sync_zero_quantity" BOOLEAN NOT NULL DEFAULT true,
    "sync_titles" BOOLEAN NOT NULL DEFAULT true,
    "sync_descriptions" BOOLEAN NOT NULL DEFAULT true,
    "sync_photos" BOOLEAN NOT NULL DEFAULT true,
    "sync_prices" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_sync_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique member_id
CREATE UNIQUE INDEX IF NOT EXISTS "member_sync_preferences_member_id_key" ON "member_sync_preferences"("member_id");

-- AddForeignKey (references Member table which uses default Prisma naming)
ALTER TABLE "member_sync_preferences" ADD CONSTRAINT "member_sync_preferences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
