-- CreateTable
CREATE TABLE "member_notification_preferences" (
    "member_id" TEXT NOT NULL,
    "notify_badges" BOOLEAN NOT NULL DEFAULT true,
    "notify_messages" BOOLEAN NOT NULL DEFAULT true,
    "notify_comments" BOOLEAN NOT NULL DEFAULT true,
    "notify_events" BOOLEAN NOT NULL DEFAULT true,
    "notify_group_admin" BOOLEAN NOT NULL DEFAULT true,
    "notify_commerce" BOOLEAN NOT NULL DEFAULT true,
    "notify_social" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_notification_preferences_pkey" PRIMARY KEY ("member_id")
);

-- AddForeignKey
ALTER TABLE "member_notification_preferences" ADD CONSTRAINT "member_notification_preferences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
