-- Remove Gamification: Points, Rewards, QR Scanning, Badges
-- This migration removes all gamification features from INW Community.

-- Drop dependent tables first (foreign key constraints)
DROP TABLE IF EXISTS "RewardRedemption" CASCADE;
DROP TABLE IF EXISTS "Reward" CASCADE;
DROP TABLE IF EXISTS "member_season_points" CASCADE;
DROP TABLE IF EXISTS "season" CASCADE;
DROP TABLE IF EXISTS "Top5Campaign" CASCADE;
DROP TABLE IF EXISTS "QRScan" CASCADE;
DROP TABLE IF EXISTS "CategoryPointsConfig" CASCADE;
DROP TABLE IF EXISTS "member_badge" CASCADE;
DROP TABLE IF EXISTS "member_badge_progress" CASCADE;
DROP TABLE IF EXISTS "business_badge" CASCADE;
DROP TABLE IF EXISTS "badge" CASCADE;

-- Remove columns from Member table
ALTER TABLE "Member" DROP COLUMN IF EXISTS "points";
ALTER TABLE "Member" DROP COLUMN IF EXISTS "all_time_points_earned";

-- Remove columns from StoreOrder table
ALTER TABLE "StoreOrder" DROP COLUMN IF EXISTS "points_awarded";
ALTER TABLE "StoreOrder" DROP COLUMN IF EXISTS "buyer_points_released_at";
ALTER TABLE "StoreOrder" DROP COLUMN IF EXISTS "order_kind";

-- Remove columns from CouponRedeem table
ALTER TABLE "CouponRedeem" DROP COLUMN IF EXISTS "points_awarded";

-- Remove columns from Post table
ALTER TABLE "Post" DROP COLUMN IF EXISTS "source_reward_id";

-- Drop index on sourceRewardId if it exists
DROP INDEX IF EXISTS "Post_source_reward_id_idx";

-- Remove 'reward' from SavedItemType enum
-- First delete any saved items with type 'reward'
DELETE FROM "SavedItem" WHERE "type" = 'reward';

-- Remove any posts with type 'shared_reward'
DELETE FROM "Post" WHERE "type" = 'shared_reward';

-- Remove any direct messages sharing rewards
UPDATE "direct_message" SET "shared_content_type" = NULL, "shared_content_id" = NULL, "shared_content_slug" = NULL WHERE "shared_content_type" = 'reward';

-- Remove any group conversation messages sharing rewards  
UPDATE "group_conversation_message" SET "shared_content_type" = NULL, "shared_content_id" = NULL, "shared_content_slug" = NULL WHERE "shared_content_type" = 'reward';
