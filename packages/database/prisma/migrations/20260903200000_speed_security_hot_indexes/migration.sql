-- Hot-path indexes from the speed/security audit.
CREATE INDEX IF NOT EXISTS "Business_member_id_idx" ON "Business"("member_id");
CREATE INDEX IF NOT EXISTS "Event_date_idx" ON "Event"("date");
CREATE INDEX IF NOT EXISTS "Event_status_date_idx" ON "Event"("status", "date");
CREATE INDEX IF NOT EXISTS "StoreItem_status_created_at_idx" ON "StoreItem"("status", "created_at");
CREATE INDEX IF NOT EXISTS "StoreItem_member_id_status_idx" ON "StoreItem"("member_id", "status");
CREATE INDEX IF NOT EXISTS "StoreItem_category_status_idx" ON "StoreItem"("category", "status");
CREATE INDEX IF NOT EXISTS "StoreOrder_buyer_id_created_at_idx" ON "StoreOrder"("buyer_id", "created_at");
CREATE INDEX IF NOT EXISTS "StoreOrder_seller_id_created_at_idx" ON "StoreOrder"("seller_id", "created_at");
CREATE INDEX IF NOT EXISTS "StoreOrder_status_created_at_idx" ON "StoreOrder"("status", "created_at");
CREATE INDEX IF NOT EXISTS "direct_message_conversation_id_created_at_idx" ON "direct_message"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "Post_author_id_created_at_idx" ON "Post"("author_id", "created_at");
CREATE INDEX IF NOT EXISTS "Post_group_id_created_at_idx" ON "Post"("group_id", "created_at");
