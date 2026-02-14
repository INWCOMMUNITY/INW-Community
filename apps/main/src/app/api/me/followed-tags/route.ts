import { NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const follows = await prisma.followTag.findMany({
    where: { memberId: session.user.id },
    include: { tag: true },
  });

  return NextResponse.json({
    tags: follows.map((f) => f.tag),
  });
}
