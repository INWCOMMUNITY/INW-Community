-- CreateTable
CREATE TABLE "seller_time_away" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_time_away_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_time_away_member_id_key" ON "seller_time_away"("member_id");

-- AddForeignKey
ALTER TABLE "seller_time_away" ADD CONSTRAINT "seller_time_away_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
