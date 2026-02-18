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

-- CreateIndex
CREATE INDEX "flagged_content_content_type_status_idx" ON "flagged_content"("content_type", "status");

-- CreateIndex
CREATE INDEX "analytics_event_event_source_idx" ON "analytics_event"("event", "source");

-- CreateIndex
CREATE INDEX "analytics_event_created_at_idx" ON "analytics_event"("created_at");
