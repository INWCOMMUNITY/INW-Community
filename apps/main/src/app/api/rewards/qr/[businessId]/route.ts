import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

const SITE_URL = process.env.NEXTAUTH_URL || "https://inwcommunity.com";

export async function GET(
  _req: NextRequest,
  { params }: { params: { businessId: string } }
) {
  const { businessId } = params;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true },
  });

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const scanUrl = `${SITE_URL}/scan/${businessId}`;

  return NextResponse.json({
    businessId: business.id,
    businessName: business.name,
    scanUrl,
    qrContent: scanUrl,
  });
}
