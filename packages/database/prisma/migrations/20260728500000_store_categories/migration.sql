-- CreateTable
CREATE TABLE "store_category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "banner_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "store_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_category_name_key" ON "store_category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "store_category_slug_key" ON "store_category"("slug");
