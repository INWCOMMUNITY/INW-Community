-- Member requests to create a group; admin approves or denies.
CREATE TABLE "group_creation_request" (
    "id" TEXT NOT NULL,
    "requester_member_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "cover_image_url" TEXT,
    "rules" TEXT,
    "allow_business_posts" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "denial_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_admin_email" TEXT,
    "resulting_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_creation_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_creation_request_resulting_group_id_key" ON "group_creation_request"("resulting_group_id");

CREATE INDEX "group_creation_request_requester_member_id_idx" ON "group_creation_request"("requester_member_id");

CREATE INDEX "group_creation_request_status_idx" ON "group_creation_request"("status");

ALTER TABLE "group_creation_request" ADD CONSTRAINT "group_creation_request_requester_member_id_fkey" FOREIGN KEY ("requester_member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_creation_request" ADD CONSTRAINT "group_creation_request_resulting_group_id_fkey" FOREIGN KEY ("resulting_group_id") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
