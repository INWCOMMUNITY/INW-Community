-- Delete-safety: StoreItem hard-delete must not cascade-destroy OrderItem history.
-- No data mutation. No commerce-foundation M1/M2/M3 tables.

ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_store_item_id_fkey";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
