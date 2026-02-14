import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const blog = await prisma.blog.findFirst({
    where: { OR: [{ id }, { slug: id }] },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.savedItem.upsert({
    where: {
      memberId_type_referenceId: {
        memberId: session.user.id,
        type: "blog",
        referenceId: blog.id,
      },
    },
    create: {
      memberId: session.user.id,
      type: "blog",
      referenceId: blog.id,
    },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const blog = await prisma.blog.findFirst({
    where: { OR: [{ id }, { slug: id }] },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.savedItem.deleteMany({
    where: {
      memberId: session.user.id,
      type: "blog",
      referenceId: blog.id,
    },
  });
  return NextResponse.json({ ok: true });
}
