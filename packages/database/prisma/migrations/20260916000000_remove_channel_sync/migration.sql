-- DropForeignKey
ALTER TABLE "batch_import_job" DROP CONSTRAINT "batch_import_job_member_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_connection" DROP CONSTRAINT "channel_connection_member_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_listing_link" DROP CONSTRAINT "channel_listing_link_connection_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_listing_link" DROP CONSTRAINT "channel_listing_link_store_item_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_sync_retry" DROP CONSTRAINT "channel_sync_retry_link_id_fkey";

-- DropForeignKey
ALTER TABLE "member_sync_preferences" DROP CONSTRAINT "member_sync_preferences_member_id_fkey";

-- DropIndex
DROP INDEX "StoreItem_shipping_option_id_idx";

-- DropIndex
DROP INDEX "shipping_option_member_id_source_remote_profile_id_key";

-- AlterTable
ALTER TABLE "StoreItem" DROP COLUMN "ebay_category_id",
DROP COLUMN "ebay_condition_enum",
DROP COLUMN "etsy_is_supply",
DROP COLUMN "etsy_taxonomy_id",
DROP COLUMN "etsy_when_made",
DROP COLUMN "etsy_who_made";

-- AlterTable
ALTER TABLE "listing_template" DROP COLUMN "ebay_aspects",
DROP COLUMN "ebay_category_id",
DROP COLUMN "etsy_is_supply",
DROP COLUMN "etsy_when_made",
DROP COLUMN "etsy_who_made";

-- AlterTable
ALTER TABLE "shipping_option" DROP COLUMN "last_imported_at",
DROP COLUMN "remote_profile_id",
DROP COLUMN "source";

-- DropTable
DROP TABLE "batch_import_job";

-- DropTable
DROP TABLE "category_mapping_feedback";

-- DropTable
DROP TABLE "category_mapping_stats";

-- DropTable
DROP TABLE "channel_category_mapping";

-- DropTable
DROP TABLE "channel_connection";

-- DropTable
DROP TABLE "channel_listing_link";

-- DropTable
DROP TABLE "channel_quota_usage";

-- DropTable
DROP TABLE "channel_sync_event";

-- DropTable
DROP TABLE "channel_sync_log";

-- DropTable
DROP TABLE "channel_sync_retry";

-- DropTable
DROP TABLE "channel_webhook_event";

-- DropTable
DROP TABLE "member_sync_preferences";

-- DropTable
DROP TABLE "quantity_audit_log";

-- DropTable
DROP TABLE "sync_trace";
