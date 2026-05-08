-- Tag saved businesses on feed posts (distinct from shared_business / posting-as-business).

ALTER TABLE "Post" ADD COLUMN "tagged_business_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
