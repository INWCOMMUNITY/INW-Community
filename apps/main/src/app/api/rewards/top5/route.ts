import { NextResponse } from "next/server";
import { prisma } from "database";

export async function GET() {
  const campaign = await prisma.top5Campaign.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!campaign || !campaign.enabled) {
    return NextResponse.json({ enabled: false });
  }
  const now = new Date();
  if (now < campaign.startDate || now > campaign.endDate) {
    return NextResponse.json({ enabled: false });
  }
  const prizes = (campaign.prizes as { rank: number; label: string; imageUrl?: string; businessId?: string }[]) ?? [];
  const businessIds = prizes.map((p) => p.businessId).filter(Boolean) as string[];
  const businesses = businessIds.length
    ? await prisma.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, name: true, slug: true, logoUrl: true },
      })
    : [];
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const prizesWithBusiness = prizes.map((p) => ({
    ...p,
    business: p.businessId ? businessMap[p.businessId] : null,
  }));
  return NextResponse.json({
    enabled: true,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    prizes: prizesWithBusiness,
  });
}
