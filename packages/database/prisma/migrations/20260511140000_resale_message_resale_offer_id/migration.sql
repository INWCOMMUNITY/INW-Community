-- AlterTable
ALTER TABLE "resale_message" ADD COLUMN "resale_offer_id" TEXT;

-- CreateIndex
CREATE INDEX "resale_message_resale_offer_id_idx" ON "resale_message"("resale_offer_id");

-- AddForeignKey
ALTER TABLE "resale_message" ADD CONSTRAINT "resale_message_resale_offer_id_fkey" FOREIGN KEY ("resale_offer_id") REFERENCES "resale_offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
