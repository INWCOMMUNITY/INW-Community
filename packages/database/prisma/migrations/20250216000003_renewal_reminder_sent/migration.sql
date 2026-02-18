-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "renewal_reminder_period_end" TIMESTAMP(3);
