-- CreateTable
CREATE TABLE "nwc_request" (
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nwc_request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "nwc_request" ADD CONSTRAINT "nwc_request_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
