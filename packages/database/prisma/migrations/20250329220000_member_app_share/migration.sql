-- CreateTable
CREATE TABLE "member_app_share" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_app_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_app_share_member_id_created_at_idx" ON "member_app_share"("member_id", "created_at");

-- AddForeignKey
ALTER TABLE "member_app_share" ADD CONSTRAINT "member_app_share_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
