import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getSessionForApi(req);
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

  const body = await req.json().catch(() => ({}));
  const agreedToRules = body?.agreedToRules === true;
  const hasRules = group.rules != null && String(group.rules).trim().length > 0;
  if (hasRules && !agreedToRules) {
    return NextResponse.json(
      { error: "You must agree to the group rules to join." },
      { status: 400 }
    );
  }

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot join groups with completely private account" }, { status: 403 });
  }

  const existing = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: group.id, memberId: session.user.id },
    },
  });

  if (existing) {
    return NextResponse.json({ error: "Already a member" }, { status: 400 });
  }

  await prisma.groupMember.create({
    data: {
      groupId: group.id,
      memberId: session.user.id,
      role: "member",
    },
  });

  return NextResponse.json({ ok: true });
}
