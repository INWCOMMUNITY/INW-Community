-- CreateTable
CREATE TABLE "listing_template" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "condition" TEXT DEFAULT 'new',
    "shippingPolicy" TEXT,
    "local_delivery_terms" TEXT,
    "pickup_terms" TEXT,
    "shipping_disabled" BOOLEAN NOT NULL DEFAULT false,
    "local_delivery_available" BOOLEAN NOT NULL DEFAULT false,
    "in_store_pickup_available" BOOLEAN NOT NULL DEFAULT false,
    "shipping_cost_cents" INTEGER,
    "local_delivery_fee_cents" INTEGER,
    "etsy_who_made" TEXT,
    "etsy_when_made" TEXT,
    "etsy_is_supply" BOOLEAN,
    "ebay_category_id" INTEGER,
    "ebay_aspects" JSONB,
    "variants_template" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_template_member_id_idx" ON "listing_template"("member_id");

-- AddForeignKey
ALTER TABLE "listing_template" ADD CONSTRAINT "listing_template_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
