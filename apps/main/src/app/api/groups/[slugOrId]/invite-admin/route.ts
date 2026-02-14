import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

const bodySchema = z.object({
  inviteeId: z.string().min(1),
});

export async function POST(
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

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: group.id, memberId: session.user.id },
    },
  });
  const isAdmin = group.createdById === session.user.id || membership?.role === "admin";
  if (!isAdmin) {
    return NextResponse.json({ error: "Only group admins can invite" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { inviteeId } = bodySchema.parse(body);

    if (inviteeId === session.user.id) {
      return NextResponse.json({ error: "Cannot invite yourself" }, { status: 400 });
    }

    const invitee = await prisma.member.findUnique({
      where: { id: inviteeId },
      select: { id: true },
    });
    if (!invitee) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const existingMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: group.id, memberId: inviteeId },
      },
    });
    if (existingMembership) {
      if (existingMembership.role === "admin") {
        return NextResponse.json({ error: "Already an admin" }, { status: 400 });
      }
      await prisma.groupMember.update({
        where: { id: existingMembership.id },
        data: { role: "admin", invitedById: session.user.id },
      });
      return NextResponse.json({ ok: true, role: "admin" });
    }

    const existingInvite = await prisma.groupAdminInvite.findUnique({
      where: {
        groupId_inviteeId: { groupId: group.id, inviteeId },
      },
    });
    if (existingInvite) {
      if (existingInvite.status === "pending") {
        return NextResponse.json({ error: "Invite already sent" }, { status: 400 });
      }
    }

    await prisma.groupAdminInvite.upsert({
      where: {
        groupId_inviteeId: { groupId: group.id, inviteeId },
      },
      create: {
        groupId: group.id,
        inviterId: session.user.id,
        inviteeId,
        status: "pending",
      },
      update: {
        inviterId: session.user.id,
        status: "pending",
      },
    });
    return NextResponse.json({ ok: true, message: "Invite sent" });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
