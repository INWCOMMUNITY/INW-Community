import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id } = await params;
  const storeItem = await prisma.storeItem.findUnique({ where: { id } });
  if (!storeItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.content === "string" ? body.content.trim().slice(0, 5000) : null;

  const post = await prisma.post.create({
    data: {
      type: "shared_store_item",
      authorId: session.user.id,
      sourceStoreItemId: storeItem.id,
      content: text || null,
      photos: [],
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });
  return NextResponse.json(post);
}
