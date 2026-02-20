import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { memberId } = await req.json();
  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  if (memberId === session.user.id) {
    return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 });
  }

  const target = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await prisma.memberBlock.upsert({
    where: {
      blockerId_blockedId: {
        blockerId: session.user.id,
        blockedId: memberId,
      },
    },
    create: {
      blockerId: session.user.id,
      blockedId: memberId,
    },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  await prisma.memberBlock.deleteMany({
    where: {
      blockerId: session.user.id,
      blockedId: memberId,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocks = await prisma.memberBlock.findMany({
    where: { blockerId: session.user.id },
    select: {
      blockedId: true,
      blocked: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(blocks);
}
