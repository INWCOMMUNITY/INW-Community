import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

const bodySchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slugOrId } = await params;
  const group = await prisma.group.findFirst({
    where: isCuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
  });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const invite = await prisma.groupAdminInvite.findUnique({
    where: {
      groupId_inviteeId: { groupId: group.id, inviteeId: session.user.id },
    },
  });
  if (!invite || invite.status !== "pending") {
    return NextResponse.json({ error: "No pending invite" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { action } = bodySchema.parse(body);

    await prisma.groupAdminInvite.update({
      where: { id: invite.id },
      data: { status: action },
    });

    if (action === "accept") {
      const existing = await prisma.groupMember.findUnique({
        where: {
          groupId_memberId: { groupId: group.id, memberId: session.user.id },
        },
      });
      if (existing) {
        await prisma.groupMember.update({
          where: { id: existing.id },
          data: { role: "admin", invitedById: invite.inviterId },
        });
      } else {
        await prisma.groupMember.create({
          data: {
            groupId: group.id,
            memberId: session.user.id,
            role: "admin",
            invitedById: invite.inviterId,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, action });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
