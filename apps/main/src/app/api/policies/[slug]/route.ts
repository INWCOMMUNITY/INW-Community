import { NextResponse } from "next/server";
import { prisma } from "database";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const policy = await prisma.policy.findUnique({
    where: { slug },
    select: { slug: true, title: true, content: true, updatedAt: true },
  });
  if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(policy);
}
