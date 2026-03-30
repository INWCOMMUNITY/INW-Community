-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('subscribe', 'sponsor', 'seller');

-- CreateEnum
CREATE TYPE "CalendarType" AS ENUM ('fun_events', 'local_art_music', 'non_profit', 'business_promotional', 'marketing', 'real_estate');

-- CreateEnum
CREATE TYPE "SavedItemType" AS ENUM ('event', 'business', 'coupon', 'store_item', 'blog', 'post', 'reward');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "profile_photo_url" TEXT,
    "bio" TEXT,
    "city" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "all_time_points_earned" INTEGER NOT NULL DEFAULT 0,
    "coupons_redeemed" INTEGER NOT NULL DEFAULT 0,
    "stripe_connect_account_id" TEXT,
    "stripe_customer_id" TEXT,
    "shippo_api_key_encrypted" TEXT,
    "shippo_oauth_token_encrypted" TEXT,
    "packing_slip_note" TEXT,
    "phone" TEXT,
    "delivery_address" JSONB,
    "seller_local_delivery_policy" TEXT,
    "seller_pickup_policy" TEXT,
    "seller_shipping_policy" TEXT,
    "seller_return_policy" TEXT,
    "accept_cash_for_pickup_delivery" BOOLEAN NOT NULL DEFAULT true,
    "offer_shipping" BOOLEAN NOT NULL DEFAULT true,
    "offer_local_delivery" BOOLEAN NOT NULL DEFAULT true,
    "offer_local_pickup" BOOLEAN NOT NULL DEFAULT true,
    "accept_offers_on_resale" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "privacy_level" TEXT NOT NULL DEFAULT 'public',
    "signup_intent" TEXT,
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webview_bridge_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webview_bridge_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_push_token" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_push_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_time_away" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_time_away_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerBalance" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "balance_cents" INTEGER NOT NULL DEFAULT 0,
    "total_earned_cents" INTEGER NOT NULL DEFAULT 0,
    "total_paid_out_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerBalanceTransaction" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "order_id" TEXT,
    "shipment_id" TEXT,
    "stripe_transfer_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerBalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "variant" JSONB,
    "fulfillment_type" TEXT,
    "local_delivery_details" JSONB,
    "pickup_details" JSONB,
    "price_override_cents" INTEGER,
    "resale_offer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "status" TEXT NOT NULL,
    "current_period_end" TIMESTAMP(3),
    "trial_end" TIMESTAMP(3),
    "renewal_reminder_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_switch_log" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "from_plan" "Plan" NOT NULL,
    "to_plan" "Plan" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_switch_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "full_description" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo_url" TEXT,
    "address" TEXT,
    "city" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subcategories_by_primary" JSONB NOT NULL DEFAULT '{}',
    "hours_of_operation" JSONB,
    "slug" TEXT NOT NULL,
    "photos" TEXT[],
    "cover_photo_url" TEXT,
    "name_approval_status" TEXT NOT NULL DEFAULT 'approved',
    "admin_granted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "image_url" TEXT,
    "secret_key" TEXT,
    "max_monthly_uses" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedeem" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "member_id" TEXT,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedeem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "business_id" TEXT,
    "calendar_type" "CalendarType" NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "end_time" TEXT,
    "location" TEXT,
    "city" TEXT,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "photos" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'approved',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInvite" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "invitee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedItem" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "type" "SavedItemType" NOT NULL,
    "reference_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "photos" TEXT[],
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogComment" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "addressee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_business" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "cover_image_url" TEXT,
    "rules" TEXT,
    "slug" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAdminInvite" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "invitee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAdminInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invited_by_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPost" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "photos" TEXT[],
    "videos" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPostComment" (
    "id" TEXT NOT NULL,
    "group_post_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupPostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPostLike" (
    "id" TEXT NOT NULL,
    "group_post_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupPostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostTag" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogTag" (
    "id" TEXT NOT NULL,
    "blog_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowTag" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT,
    "photos" TEXT[],
    "videos" TEXT[],
    "links" JSONB,
    "source_blog_id" TEXT,
    "source_post_id" TEXT,
    "source_business_id" TEXT,
    "source_coupon_id" TEXT,
    "source_reward_id" TEXT,
    "source_store_item_id" TEXT,
    "group_id" TEXT,
    "tagged_member_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "member_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostCommentLike" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteContent" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "structure" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignTokens" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignTokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_season_points" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "points_earned" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_season_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Top5Campaign" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "prizes" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Top5Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points_required" INTEGER NOT NULL,
    "cash_value_cents" INTEGER,
    "redemption_limit" INTEGER NOT NULL,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "needs_shipping" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "season_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "points_spent" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_order_id" TEXT,
    "fulfillment_status" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "notes_to_business" TEXT,
    "shipping_address" JSONB,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreItem" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "business_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photos" TEXT[],
    "category" TEXT,
    "subcategory" TEXT,
    "price_cents" INTEGER NOT NULL,
    "variants" JSONB,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "shipping_cost_cents" INTEGER,
    "shipping_policy" TEXT,
    "local_delivery_available" BOOLEAN NOT NULL DEFAULT false,
    "local_delivery_fee_cents" INTEGER,
    "in_store_pickup_available" BOOLEAN NOT NULL DEFAULT false,
    "shipping_disabled" BOOLEAN NOT NULL DEFAULT false,
    "local_delivery_terms" TEXT,
    "pickup_terms" TEXT,
    "stripe_price_id" TEXT,
    "slug" TEXT NOT NULL,
    "listing_type" TEXT NOT NULL DEFAULT 'new',
    "accept_offers" BOOLEAN NOT NULL DEFAULT true,
    "min_offer_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrder" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "shipping_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "subtotal_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shipping_address" JSONB,
    "local_delivery_details" JSONB,
    "delivery_confirmed_at" TIMESTAMP(3),
    "delivery_buyer_confirmed_at" TIMESTAMP(3),
    "pickup_seller_confirmed_at" TIMESTAMP(3),
    "pickup_buyer_confirmed_at" TIMESTAMP(3),
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "buyer_points_released_at" TIMESTAMP(3),
    "refund_requested_at" TIMESTAMP(3),
    "refund_reason" TEXT,
    "cancel_reason" TEXT,
    "cancel_note" TEXT,
    "inventory_restored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "package_weight_oz" DOUBLE PRECISION,
    "package_length_in" DOUBLE PRECISION,
    "package_width_in" DOUBLE PRECISION,
    "package_height_in" DOUBLE PRECISION,
    "shipped_with_order_id" TEXT,
    "order_kind" TEXT NOT NULL DEFAULT 'storefront',

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "tracking_number" TEXT,
    "label_url" TEXT,
    "label_cost_cents" INTEGER NOT NULL,
    "nwc_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "weight_oz" DOUBLE PRECISION NOT NULL,
    "length_in" DOUBLE PRECISION NOT NULL,
    "width_in" DOUBLE PRECISION NOT NULL,
    "height_in" DOUBLE PRECISION NOT NULL,
    "shippo_transaction_id" TEXT,
    "shippo_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_cents_at_purchase" INTEGER NOT NULL,
    "variant" JSONB,
    "fulfillment_type" TEXT,
    "pickup_details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_offer" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "seller_response" TEXT,
    "counter_amount_cents" INTEGER,
    "final_amount_cents" INTEGER,
    "accepted_at" TIMESTAMP(3),
    "checkout_deadline_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "resale_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_conversation" (
    "id" TEXT NOT NULL,
    "store_item_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "buyer_last_read_at" TIMESTAMP(3),
    "seller_last_read_at" TIMESTAMP(3),

    CONSTRAINT "resale_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_conversation" (
    "id" TEXT NOT NULL,
    "member_a_id" TEXT NOT NULL,
    "member_b_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "requested_by_member_id" TEXT,
    "member_a_last_read_at" TIMESTAMP(3),
    "member_b_last_read_at" TIMESTAMP(3),
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

-- CreateTable
CREATE TABLE "direct_message_like" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_message_reaction" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_conversation" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_conversation_member" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "group_conversation_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_conversation_message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "shared_content_type" TEXT,
    "shared_content_id" TEXT,
    "shared_content_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_conversation_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_conversation_message_reaction" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_conversation_message_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QRScan" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "points_awarded" INTEGER NOT NULL,

    CONSTRAINT "QRScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryPointsConfig" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "points_per_scan" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryPointsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTodo" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image_url" TEXT,
    "category" TEXT NOT NULL,
    "criteria" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_badge" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_on_profile" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "member_badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_badge_progress" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "progress_key" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_badge_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_badge" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_on_page" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "business_badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_link" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_signup" (
    "id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "new_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_signup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nwc_request" (
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nwc_request_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "flagged_content" (
    "id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_id" TEXT,
    "reason" TEXT NOT NULL,
    "snippet" TEXT,
    "author_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flagged_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_event" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT,
    "name" TEXT,
    "value" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_block" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "webview_bridge_token_token_key" ON "webview_bridge_token"("token");

-- CreateIndex
CREATE INDEX "webview_bridge_token_member_id_idx" ON "webview_bridge_token"("member_id");

-- CreateIndex
CREATE INDEX "webview_bridge_token_expires_at_idx" ON "webview_bridge_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_push_token_token_key" ON "member_push_token"("token");

-- CreateIndex
CREATE INDEX "member_push_token_member_id_idx" ON "member_push_token"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_time_away_member_id_key" ON "seller_time_away"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "SellerBalance_member_id_key" ON "SellerBalance"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_resale_offer_id_key" ON "CartItem"("resale_offer_id");

-- CreateIndex
CREATE INDEX "CartItem_member_id_idx" ON "CartItem"("member_id");

-- CreateIndex
CREATE INDEX "plan_switch_log_member_id_created_at_idx" ON "plan_switch_log"("member_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "CouponRedeem_coupon_id_idx" ON "CouponRedeem"("coupon_id");

-- CreateIndex
CREATE INDEX "CouponRedeem_member_id_idx" ON "CouponRedeem"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "EventInvite_invitee_id_idx" ON "EventInvite"("invitee_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvite_event_id_invitee_id_key" ON "EventInvite"("event_id", "invitee_id");

-- CreateIndex
CREATE INDEX "SavedItem_member_id_idx" ON "SavedItem"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "SavedItem_member_id_type_reference_id_key" ON "SavedItem"("member_id", "type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Blog_slug_key" ON "Blog"("slug");

-- CreateIndex
CREATE INDEX "Blog_member_id_idx" ON "Blog"("member_id");

-- CreateIndex
CREATE INDEX "Blog_category_id_idx" ON "Blog"("category_id");

-- CreateIndex
CREATE INDEX "Blog_status_idx" ON "Blog"("status");

-- CreateIndex
CREATE INDEX "BlogComment_blog_id_idx" ON "BlogComment"("blog_id");

-- CreateIndex
CREATE INDEX "FriendRequest_addressee_id_idx" ON "FriendRequest"("addressee_id");

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_requester_id_addressee_id_key" ON "FriendRequest"("requester_id", "addressee_id");

-- CreateIndex
CREATE INDEX "Follow_following_id_idx" ON "Follow"("following_id");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_follower_id_following_id_key" ON "Follow"("follower_id", "following_id");

-- CreateIndex
CREATE INDEX "follow_business_business_id_idx" ON "follow_business"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_business_member_id_business_id_key" ON "follow_business"("member_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "Group_slug_key" ON "Group"("slug");

-- CreateIndex
CREATE INDEX "Group_created_by_id_idx" ON "Group"("created_by_id");

-- CreateIndex
CREATE INDEX "GroupAdminInvite_invitee_id_idx" ON "GroupAdminInvite"("invitee_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAdminInvite_group_id_invitee_id_key" ON "GroupAdminInvite"("group_id", "invitee_id");

-- CreateIndex
CREATE INDEX "GroupMember_member_id_idx" ON "GroupMember"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_group_id_member_id_key" ON "GroupMember"("group_id", "member_id");

-- CreateIndex
CREATE INDEX "GroupPost_group_id_idx" ON "GroupPost"("group_id");

-- CreateIndex
CREATE INDEX "GroupPostComment_group_post_id_idx" ON "GroupPostComment"("group_post_id");

-- CreateIndex
CREATE INDEX "GroupPostLike_member_id_idx" ON "GroupPostLike"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPostLike_group_post_id_member_id_key" ON "GroupPostLike"("group_post_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_slug_idx" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "PostTag_tag_id_idx" ON "PostTag"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "PostTag_post_id_tag_id_key" ON "PostTag"("post_id", "tag_id");

-- CreateIndex
CREATE INDEX "BlogTag_tag_id_idx" ON "BlogTag"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "BlogTag_blog_id_tag_id_key" ON "BlogTag"("blog_id", "tag_id");

-- CreateIndex
CREATE INDEX "FollowTag_tag_id_idx" ON "FollowTag"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "FollowTag_member_id_tag_id_key" ON "FollowTag"("member_id", "tag_id");

-- CreateIndex
CREATE INDEX "Post_author_id_idx" ON "Post"("author_id");

-- CreateIndex
CREATE INDEX "Post_group_id_idx" ON "Post"("group_id");

-- CreateIndex
CREATE INDEX "Post_created_at_idx" ON "Post"("created_at");

-- CreateIndex
CREATE INDEX "PostComment_post_id_idx" ON "PostComment"("post_id");

-- CreateIndex
CREATE INDEX "PostComment_parent_id_idx" ON "PostComment"("parent_id");

-- CreateIndex
CREATE INDEX "PostCommentLike_member_id_idx" ON "PostCommentLike"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "PostCommentLike_comment_id_member_id_key" ON "PostCommentLike"("comment_id", "member_id");

-- CreateIndex
CREATE INDEX "PostLike_member_id_idx" ON "PostLike"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "PostLike_post_id_member_id_key" ON "PostLike"("post_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "SiteContent_page_id_key" ON "SiteContent"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "DesignTokens_key_key" ON "DesignTokens"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_code_key" ON "AdminSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_slug_key" ON "Policy"("slug");

-- CreateIndex
CREATE INDEX "member_season_points_season_id_idx" ON "member_season_points"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_season_points_member_id_season_id_key" ON "member_season_points"("member_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_store_order_id_key" ON "RewardRedemption"("store_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "StoreItem_slug_key" ON "StoreItem"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_order_id_key" ON "Shipment"("order_id");

-- CreateIndex
CREATE INDEX "resale_offer_store_item_id_idx" ON "resale_offer"("store_item_id");

-- CreateIndex
CREATE INDEX "resale_offer_buyer_id_idx" ON "resale_offer"("buyer_id");

-- CreateIndex
CREATE INDEX "resale_conversation_seller_id_idx" ON "resale_conversation"("seller_id");

-- CreateIndex
CREATE INDEX "resale_conversation_buyer_id_idx" ON "resale_conversation"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "resale_conversation_store_item_id_buyer_id_key" ON "resale_conversation"("store_item_id", "buyer_id");

-- CreateIndex
CREATE INDEX "resale_message_conversation_id_idx" ON "resale_message"("conversation_id");

-- CreateIndex
CREATE INDEX "direct_conversation_member_a_id_idx" ON "direct_conversation"("member_a_id");

-- CreateIndex
CREATE INDEX "direct_conversation_member_b_id_idx" ON "direct_conversation"("member_b_id");

-- CreateIndex
CREATE INDEX "direct_conversation_status_idx" ON "direct_conversation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "direct_conversation_member_a_id_member_b_id_key" ON "direct_conversation"("member_a_id", "member_b_id");

-- CreateIndex
CREATE INDEX "direct_message_conversation_id_idx" ON "direct_message"("conversation_id");

-- CreateIndex
CREATE INDEX "direct_message_like_member_id_idx" ON "direct_message_like"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_message_like_message_id_member_id_key" ON "direct_message_like"("message_id", "member_id");

-- CreateIndex
CREATE INDEX "direct_message_reaction_member_id_idx" ON "direct_message_reaction"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_message_reaction_message_id_member_id_emoji_key" ON "direct_message_reaction"("message_id", "member_id", "emoji");

-- CreateIndex
CREATE INDEX "group_conversation_member_member_id_idx" ON "group_conversation_member"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_conversation_member_conversation_id_member_id_key" ON "group_conversation_member"("conversation_id", "member_id");

-- CreateIndex
CREATE INDEX "group_conversation_message_conversation_id_idx" ON "group_conversation_message"("conversation_id");

-- CreateIndex
CREATE INDEX "group_conversation_message_reaction_member_id_idx" ON "group_conversation_message_reaction"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_conversation_message_reaction_message_id_member_id_em_key" ON "group_conversation_message_reaction"("message_id", "member_id", "emoji");

-- CreateIndex
CREATE INDEX "QRScan_member_id_business_id_idx" ON "QRScan"("member_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryPointsConfig_category_key" ON "CategoryPointsConfig"("category");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "badge_slug_key" ON "badge"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "member_badge_member_id_badge_id_key" ON "member_badge"("member_id", "badge_id");

-- CreateIndex
CREATE INDEX "member_badge_progress_member_id_idx" ON "member_badge_progress"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_badge_progress_member_id_progress_key_key" ON "member_badge_progress"("member_id", "progress_key");

-- CreateIndex
CREATE UNIQUE INDEX "business_badge_business_id_badge_id_key" ON "business_badge"("business_id", "badge_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_link_code_key" ON "referral_link"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_signup_referrer_id_new_member_id_key" ON "referral_signup"("referrer_id", "new_member_id");

-- CreateIndex
CREATE INDEX "nwc_request_created_at_idx" ON "nwc_request"("created_at");

-- CreateIndex
CREATE INDEX "report_content_type_content_id_idx" ON "report"("content_type", "content_id");

-- CreateIndex
CREATE INDEX "report_status_idx" ON "report"("status");

-- CreateIndex
CREATE INDEX "flagged_content_content_type_status_idx" ON "flagged_content"("content_type", "status");

-- CreateIndex
CREATE INDEX "analytics_event_event_source_idx" ON "analytics_event"("event", "source");

-- CreateIndex
CREATE INDEX "analytics_event_created_at_idx" ON "analytics_event"("created_at");

-- CreateIndex
CREATE INDEX "member_block_blocker_id_idx" ON "member_block"("blocker_id");

-- CreateIndex
CREATE INDEX "member_block_blocked_id_idx" ON "member_block"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_block_blocker_id_blocked_id_key" ON "member_block"("blocker_id", "blocked_id");

-- AddForeignKey
ALTER TABLE "webview_bridge_token" ADD CONSTRAINT "webview_bridge_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_push_token" ADD CONSTRAINT "member_push_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_time_away" ADD CONSTRAINT "seller_time_away_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerBalance" ADD CONSTRAINT "SellerBalance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerBalanceTransaction" ADD CONSTRAINT "SellerBalanceTransaction_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_resale_offer_id_fkey" FOREIGN KEY ("resale_offer_id") REFERENCES "resale_offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_switch_log" ADD CONSTRAINT "plan_switch_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedeem" ADD CONSTRAINT "CouponRedeem_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedeem" ADD CONSTRAINT "CouponRedeem_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedItem" ADD CONSTRAINT "SavedItem_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "BlogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_business" ADD CONSTRAINT "follow_business_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_business" ADD CONSTRAINT "follow_business_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAdminInvite" ADD CONSTRAINT "GroupAdminInvite_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAdminInvite" ADD CONSTRAINT "GroupAdminInvite_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAdminInvite" ADD CONSTRAINT "GroupAdminInvite_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPost" ADD CONSTRAINT "GroupPost_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPost" ADD CONSTRAINT "GroupPost_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPostComment" ADD CONSTRAINT "GroupPostComment_group_post_id_fkey" FOREIGN KEY ("group_post_id") REFERENCES "GroupPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPostComment" ADD CONSTRAINT "GroupPostComment_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPostLike" ADD CONSTRAINT "GroupPostLike_group_post_id_fkey" FOREIGN KEY ("group_post_id") REFERENCES "GroupPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPostLike" ADD CONSTRAINT "GroupPostLike_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogTag" ADD CONSTRAINT "BlogTag_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "Blog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogTag" ADD CONSTRAINT "BlogTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowTag" ADD CONSTRAINT "FollowTag_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowTag" ADD CONSTRAINT "FollowTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_season_points" ADD CONSTRAINT "member_season_points_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_season_points" ADD CONSTRAINT "member_season_points_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_offer" ADD CONSTRAINT "resale_offer_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_offer" ADD CONSTRAINT "resale_offer_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_conversation" ADD CONSTRAINT "resale_conversation_store_item_id_fkey" FOREIGN KEY ("store_item_id") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_conversation" ADD CONSTRAINT "resale_conversation_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_conversation" ADD CONSTRAINT "resale_conversation_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_message" ADD CONSTRAINT "resale_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "resale_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_message" ADD CONSTRAINT "resale_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_member_a_id_fkey" FOREIGN KEY ("member_a_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_conversation" ADD CONSTRAINT "direct_conversation_member_b_id_fkey" FOREIGN KEY ("member_b_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "direct_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_like" ADD CONSTRAINT "direct_message_like_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_like" ADD CONSTRAINT "direct_message_like_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation" ADD CONSTRAINT "group_conversation_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_member" ADD CONSTRAINT "group_conversation_member_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "group_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_member" ADD CONSTRAINT "group_conversation_member_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_message" ADD CONSTRAINT "group_conversation_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "group_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_message" ADD CONSTRAINT "group_conversation_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_message_reaction" ADD CONSTRAINT "group_conversation_message_reaction_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "group_conversation_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_conversation_message_reaction" ADD CONSTRAINT "group_conversation_message_reaction_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QRScan" ADD CONSTRAINT "QRScan_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QRScan" ADD CONSTRAINT "QRScan_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badge" ADD CONSTRAINT "member_badge_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badge" ADD CONSTRAINT "member_badge_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_badge_progress" ADD CONSTRAINT "member_badge_progress_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_badge" ADD CONSTRAINT "business_badge_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_badge" ADD CONSTRAINT "business_badge_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_link" ADD CONSTRAINT "referral_link_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_signup" ADD CONSTRAINT "referral_signup_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_signup" ADD CONSTRAINT "referral_signup_new_member_id_fkey" FOREIGN KEY ("new_member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nwc_request" ADD CONSTRAINT "nwc_request_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_block" ADD CONSTRAINT "member_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
