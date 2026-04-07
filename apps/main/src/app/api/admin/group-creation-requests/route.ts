import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "pending").trim();
  const allowed = ["pending", "approved", "denied", "all"];
  const statusFilter = allowed.includes(status) ? status : "pending";

  const where =
    statusFilter === "all"
      ? {}
      : { status: statusFilter };

  const rows = await prisma.groupCreationRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      requester: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      resultingGroup: { select: { id: true, slug: true, name: true } },
    },
  });

  return NextResponse.json({ requests: rows });
}
