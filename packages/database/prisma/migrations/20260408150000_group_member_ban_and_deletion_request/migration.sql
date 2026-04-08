-- Permanent ban from rejoining a group after admin removal.
CREATE TABLE "group_member_ban" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "banned_by_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_member_ban_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_member_ban_group_id_member_id_key" ON "group_member_ban"("group_id", "member_id");

CREATE INDEX "group_member_ban_member_id_idx" ON "group_member_ban"("member_id");

ALTER TABLE "group_member_ban" ADD CONSTRAINT "group_member_ban_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_member_ban" ADD CONSTRAINT "group_member_ban_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_member_ban" ADD CONSTRAINT "group_member_ban_banned_by_member_id_fkey" FOREIGN KEY ("banned_by_member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Creator-initiated group deletion; platform admin approves.
CREATE TABLE "group_deletion_request" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "requester_member_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "denial_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_admin_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_deletion_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_deletion_request_group_id_idx" ON "group_deletion_request"("group_id");

CREATE INDEX "group_deletion_request_status_idx" ON "group_deletion_request"("status");

ALTER TABLE "group_deletion_request" ADD CONSTRAINT "group_deletion_request_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_deletion_request" ADD CONSTRAINT "group_deletion_request_requester_member_id_fkey" FOREIGN KEY ("requester_member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
