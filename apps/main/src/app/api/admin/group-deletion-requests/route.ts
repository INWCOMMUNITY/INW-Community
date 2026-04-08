import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "pending";

  const rows = await prisma.groupDeletionRequest.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    include: {
      group: { select: { id: true, name: true, slug: true } },
      requester: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  return NextResponse.json({ requests: rows });
}
