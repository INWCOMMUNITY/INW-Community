-- CreateTable
CREATE TABLE "batch_import_job" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batch_import_job_member_id_created_at_idx" ON "batch_import_job"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "batch_import_job_status_idx" ON "batch_import_job"("status");

-- AddForeignKey
ALTER TABLE "batch_import_job" ADD CONSTRAINT "batch_import_job_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
