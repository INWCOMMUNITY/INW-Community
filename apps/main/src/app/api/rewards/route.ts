import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getCurrentSeasonId } from "@/lib/award-points";
import { z } from "zod";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { awardCommunityStarBusinessBadge, type EarnedBadge } from "@/lib/badge-award";

export async function GET(req: NextRequest) {
  const currentSeasonId = await getCurrentSeasonId();
  const rewards = await prisma.reward.findMany({
    where: {
      status: "active",
      OR: [
        { seasonId: null },
        ...(currentSeasonId ? [{ seasonId: currentSeasonId }] : []),
      ],
    },
    include: {
      business: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const available = rewards.filter((r) => r.timesRedeemed < r.redemptionLimit);
  return NextResponse.json(available);
}

const createSchema = z.object({
  businessId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  pointsRequired: z.number().int().min(1),
  redemptionLimit: z.number().int().min(1),
  cashValueCents: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().nullable().optional().or(z.literal("")),
  needsShipping: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasBusinessHubAccess(session.user.id))) {
    return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const business = await prisma.business.findFirst({
      where: { id: body.businessId, memberId: session.user.id },
    });
    if (!business) {
      return NextResponse.json({ error: "Business not found or not yours" }, { status: 404 });
    }
    const data = createSchema.parse({
      ...body,
      imageUrl: body.imageUrl || null,
    });
    const created = await prisma.reward.create({
      data: {
        businessId: data.businessId,
        title: data.title,
        description: data.description ?? null,
        pointsRequired: data.pointsRequired,
        redemptionLimit: data.redemptionLimit,
        cashValueCents: data.cashValueCents ?? null,
        imageUrl: data.imageUrl ?? null,
        needsShipping: data.needsShipping === true,
      },
    });
    let earnedBadges: EarnedBadge[] = [];
    try {
      earnedBadges = await awardCommunityStarBusinessBadge(data.businessId);
    } catch {
      /* badge errors should not break reward create */
    }
    return NextResponse.json({ ok: true, rewardId: created.id, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
