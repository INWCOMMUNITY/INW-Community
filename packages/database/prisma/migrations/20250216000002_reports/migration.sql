-- CreateTable
CREATE TABLE "report" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_content_type_content_id_idx" ON "report"("content_type", "content_id");

-- CreateIndex
CREATE INDEX "report_status_idx" ON "report"("status");

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
