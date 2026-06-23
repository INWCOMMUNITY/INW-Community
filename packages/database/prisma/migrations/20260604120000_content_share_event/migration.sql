-- CreateTable
CREATE TABLE "content_share_event" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "share_day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_share_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_share_event_content_type_content_id_idx" ON "content_share_event"("content_type", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_share_event_member_id_content_type_content_id_chann_key" ON "content_share_event"("member_id", "content_type", "content_id", "channel", "share_day");

-- AddForeignKey
ALTER TABLE "content_share_event" ADD CONSTRAINT "content_share_event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
