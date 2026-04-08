-- Track when admin dismissed dashboard queue reminders (group requests, flagged, etc.).

CREATE TABLE "admin_dashboard_queue_dismissal" (
    "id" TEXT NOT NULL,
    "queue_key" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_dashboard_queue_dismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_dashboard_queue_dismissal_queue_key_key" ON "admin_dashboard_queue_dismissal"("queue_key");
