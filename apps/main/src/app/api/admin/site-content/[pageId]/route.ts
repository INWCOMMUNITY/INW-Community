import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import type { PageStructure } from "types";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await params;
  const row = await prisma.siteContent.findUnique({
    where: { pageId },
  });
  const structure = (row?.structure as unknown as PageStructure) ?? { sections: [] };
  return NextResponse.json(structure);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const structure = JSON.parse(JSON.stringify(body));
  await prisma.siteContent.upsert({
    where: { pageId },
    create: { pageId, structure },
    update: { structure },
  });
  return NextResponse.json({ ok: true });
}
