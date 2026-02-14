-- CreateTable
CREATE TABLE "direct_conversation" (
    "id" TEXT NOT NULL,
    "member_a_id" TEXT NOT NULL,
    "member_b_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "shared_content_type" TEXT,
    "shared_content_id" TEXT,
    "shared_content_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_conversation_member_a_id_member_b_id_key" ON "direct_conversation"("member_a_id", "member_b_id");

-- CreateIndex
CREATE INDEX "direct_conversation_member_a_id_idx" ON "direct_conversation"("member_a_id");

-- CreateIndex
CREATE INDEX "direct_conversation_member_b_id_idx" ON "direct_conversation"("member_b_id");

-- CreateIndex
CREATE INDEX "direct_message_conversation_id_idx" ON "direct_message"("conversation_id");

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_member_a_id_fkey" FOREIGN KEY ("member_a_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_member_b_id_fkey" FOREIGN KEY ("member_b_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "direct_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
