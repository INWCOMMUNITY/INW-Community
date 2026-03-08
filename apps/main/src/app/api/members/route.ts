import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const skip = page * limit;

  const baseWhere = {
    id: { not: session.user.id },
    privacyLevel: { not: "completely_private" },
    status: "active",
  };

  if (q.length >= 2) {
    const members = await prisma.member.findMany({
      where: {
        ...baseWhere,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePhotoUrl: true,
        city: true,
      },
      take: limit,
      skip,
    });
    return NextResponse.json({ members });
  }

  // Browse: return first page of members when q is empty
  const members = await prisma.member.findMany({
    where: baseWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      city: true,
    },
    take: limit,
    skip,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ members });
}
