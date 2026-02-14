import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";


export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const policies = await prisma.policy.findMany({
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return NextResponse.json(policies);
}
