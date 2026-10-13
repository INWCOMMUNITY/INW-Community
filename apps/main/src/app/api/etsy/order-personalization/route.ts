import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const rows = await prisma.etsyOrderLineSaleFact.findMany({
    where: { memberId, personalizationJson: { not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      etsyReceiptId: true,
      etsyListingId: true,
      paidQuantity: true,
      personalizationJson: true,
      createdAt: true,
      storeItemId: true,
    },
  });
  return NextResponse.json({ sales: rows });
}
