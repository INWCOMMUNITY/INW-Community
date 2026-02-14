import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "10", 10) || 10, 1), 100);
  const topMembers = await prisma.member.findMany({
    where: { points: { gt: 0 } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      points: true,
    },
    orderBy: { points: "desc" },
    take: limit,
  });
  return NextResponse.json(topMembers);
}
