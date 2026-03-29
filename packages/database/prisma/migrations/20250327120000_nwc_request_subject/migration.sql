-- AlterTable
ALTER TABLE "nwc_request" ADD COLUMN "subject" TEXT NOT NULL DEFAULT '';

CREATE INDEX "nwc_request_created_at_idx" ON "nwc_request"("created_at");
