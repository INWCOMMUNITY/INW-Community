import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  memberId: z.string().min(1),
  action: z.enum(["follow", "unfollow"]).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { memberId, action } = bodySchema.parse(body);

    if (memberId === session.user.id) {
      return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
    }

    const target = await prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, privacyLevel: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (target.privacyLevel === "completely_private") {
      return NextResponse.json({ error: "Cannot follow this member" }, { status: 403 });
    }

    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: memberId,
        },
      },
    });

    const doFollow = action !== "unfollow";
    if (doFollow) {
      if (existing) {
        return NextResponse.json({ ok: true, following: true });
      }
      await prisma.follow.create({
        data: {
          followerId: session.user.id,
          followingId: memberId,
        },
      });
      return NextResponse.json({ ok: true, following: true });
    } else {
      if (existing) {
        await prisma.follow.delete({
          where: { id: existing.id },
        });
      }
      return NextResponse.json({ ok: true, following: false });
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
