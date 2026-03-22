import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const REDEEM_ERR = {
  notFound: { status: 404 as const, body: { error: "Reward not found or no longer available" } },
  limit: { status: 400 as const, body: { error: "This reward has been fully redeemed" } },
  points: (have: number, need: number) => ({
    status: 400 as const,
    body: { error: `You need ${need} points. You have ${have}.` },
  }),
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rewardId } = await params;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const rewardRow = await tx.reward.findFirst({
          where: { id: rewardId, status: "active" },
          include: { business: { select: { name: true, memberId: true } } },
        });
        if (!rewardRow) {
          throw Object.assign(new Error("NOT_FOUND"), { redeemCode: "NOT_FOUND" as const });
        }
        if (rewardRow.timesRedeemed >= rewardRow.redemptionLimit) {
          throw Object.assign(new Error("LIMIT"), { redeemCode: "LIMIT" as const });
        }

        const memberRow = await tx.member.findUnique({
          where: { id: session.user.id },
          select: { points: true, email: true, phone: true },
        });
        if (!memberRow || memberRow.points < rewardRow.pointsRequired) {
          throw Object.assign(new Error("POINTS"), {
            redeemCode: "POINTS" as const,
            have: memberRow?.points ?? 0,
            need: rewardRow.pointsRequired,
          });
        }

        const redemptionData = rewardRow.needsShipping
          ? {
              memberId: session.user.id,
              rewardId,
              pointsSpent: rewardRow.pointsRequired,
              fulfillmentStatus: "pending_checkout" as const,
              contactEmail: memberRow.email ?? null,
              contactPhone: memberRow.phone ?? null,
            }
          : {
              memberId: session.user.id,
              rewardId,
              pointsSpent: rewardRow.pointsRequired,
            };

        await tx.member.update({
          where: { id: session.user.id },
          data: { points: { decrement: rewardRow.pointsRequired } },
        });
        await tx.reward.update({
          where: { id: rewardId },
          data: { timesRedeemed: { increment: 1 } },
        });
        const row = await tx.rewardRedemption.create({
          data: redemptionData,
        });

        const after = await tx.reward.findUnique({
          where: { id: rewardId },
          select: { timesRedeemed: true, redemptionLimit: true },
        });
        if (after && after.timesRedeemed >= after.redemptionLimit) {
          await tx.reward.update({
            where: { id: rewardId },
            data: { status: "redeemed_out" },
          });
        }

        return { redemptionId: row.id, needsShipping: rewardRow.needsShipping };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      }
    );

    if (result.needsShipping) {
      return NextResponse.json({
        ok: true,
        needsShippingAddress: true,
        redemptionId: result.redemptionId,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e && typeof e === "object" && "redeemCode" in e) {
      const code = (e as { redeemCode: string; have?: number; need?: number }).redeemCode;
      if (code === "NOT_FOUND") {
        return NextResponse.json(REDEEM_ERR.notFound.body, { status: REDEEM_ERR.notFound.status });
      }
      if (code === "LIMIT") {
        return NextResponse.json(REDEEM_ERR.limit.body, { status: REDEEM_ERR.limit.status });
      }
      if (code === "POINTS") {
        const x = e as unknown as { have?: number; need?: number };
        if (typeof x.have === "number" && typeof x.need === "number") {
          const r = REDEEM_ERR.points(x.have, x.need);
          return NextResponse.json(r.body, { status: r.status });
        }
      }
    }
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2034"
    ) {
      return NextResponse.json(
        { error: "Could not complete redemption because another request updated this reward. Please try again." },
        { status: 409 }
      );
    }
    console.error("[rewards/redeem]", e);
    return NextResponse.json({ error: "Failed to redeem" }, { status: 500 });
  }
}
