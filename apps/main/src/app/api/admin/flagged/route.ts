import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "pending";
  const list = await prisma.flaggedContent.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(list);
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }
    if (!["pending", "reviewed", "removed"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const row = await prisma.flaggedContent.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (status === "removed" && row.contentId) {
      const contentId = row.contentId;
      switch (row.contentType) {
        case "post":
          await prisma.post.deleteMany({ where: { id: contentId } });
          break;
        case "message":
          await prisma.directMessage.deleteMany({ where: { id: contentId } });
          await prisma.groupConversationMessage.deleteMany({ where: { id: contentId } });
          await prisma.resaleMessage.deleteMany({ where: { id: contentId } });
          break;
        case "business":
          await prisma.business.deleteMany({ where: { id: contentId } });
          break;
        case "event":
          await prisma.event.deleteMany({ where: { id: contentId } });
          break;
        case "store_item":
          await prisma.storeItem.updateMany({
            where: { id: contentId },
            data: { status: "inactive" },
          });
          break;
        default:
          break;
      }
    }

    await prisma.flaggedContent.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
