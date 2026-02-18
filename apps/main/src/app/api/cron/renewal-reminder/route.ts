import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { sendRenewalReminderEmail } from "@/lib/send-renewal-reminder-email";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const subs = await prisma.subscription.findMany({
      where: {
        status: "active",
        currentPeriodEnd: { gte: inTwoDays, lt: inThreeDays },
      },
      include: { member: { select: { email: true, firstName: true, lastName: true } } },
    });

    const toRemind = subs.filter(
      (s) =>
        s.currentPeriodEnd &&
        (s.renewalReminderPeriodEnd == null || s.renewalReminderPeriodEnd.getTime() !== s.currentPeriodEnd.getTime())
    );

    const planAmounts: Record<string, number> = {
      subscribe: 999,
      sponsor: 1999,
      seller: 1999,
    };

    let sent = 0;
    for (const sub of toRemind) {
      if (!sub.currentPeriodEnd || !sub.member?.email) continue;

      const periodEnd = sub.currentPeriodEnd;

      const amountCents = planAmounts[sub.plan] ?? 0;
      const ok = await sendRenewalReminderEmail({
        to: sub.member.email,
        memberName: sub.member.firstName && sub.member.lastName ? `${sub.member.firstName} ${sub.member.lastName}` : null,
        plan: sub.plan,
        amountCents,
        periodEnd,
        billingInterval: "month",
      });

      if (ok) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { renewalReminderPeriodEnd: periodEnd },
        });
        sent++;
      }
    }

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    console.error("[cron/renewal-reminder]", e);
    return NextResponse.json({ error: "Failed to run cron" }, { status: 500 });
  }
}
