-- Plan switch audit + rate limit (change-plan API)
CREATE TABLE "plan_switch_log" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "from_plan" "Plan" NOT NULL,
    "to_plan" "Plan" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_switch_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_switch_log_member_id_created_at_idx" ON "plan_switch_log"("member_id", "created_at");

ALTER TABLE "plan_switch_log" ADD CONSTRAINT "plan_switch_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
