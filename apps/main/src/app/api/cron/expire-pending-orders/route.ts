import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

export const maxDuration = 30;

/** Run daily. Cancel store orders that have been pending for more than 24 hours (e.g. abandoned checkout). */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const result = await prisma.storeOrder.updateMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    data: { status: "canceled" },
  });

  return NextResponse.json({ ok: true, canceled: result.count });
}
