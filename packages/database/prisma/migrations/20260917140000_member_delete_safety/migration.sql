-- Member-delete safety: preserve commerce/financial history; close accounts instead of cascading destroy.
-- Data-preserving: no Member/commerce DML. auth_epoch DEFAULT 0 backfills existing rows.

ALTER TABLE "Member" ADD COLUMN "closed_at" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "auth_epoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "StoreOrder" DROP CONSTRAINT "StoreOrder_buyer_id_fkey";
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreOrder" DROP CONSTRAINT "StoreOrder_seller_id_fkey";
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreItem" DROP CONSTRAINT "StoreItem_member_id_fkey";
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerBalance" DROP CONSTRAINT "SellerBalance_member_id_fkey";
ALTER TABLE "SellerBalance" ADD CONSTRAINT "SellerBalance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerBalanceTransaction" DROP CONSTRAINT "SellerBalanceTransaction_member_id_fkey";
ALTER TABLE "SellerBalanceTransaction" ADD CONSTRAINT "SellerBalanceTransaction_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
