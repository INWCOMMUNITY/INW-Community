import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const postBodySchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(20),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.groupConversation.findUnique({
    where: { id },
    include: { members: { select: { memberId: true } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const isMember = conversation.members.some((m) => m.memberId === session.user.id);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let data: z.infer<typeof postBodySchema>;
  try {
    const body = await req.json();
    data = postBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const existingIds = new Set(conversation.members.map((m) => m.memberId));
  const toAdd = data.memberIds.filter((mid) => !existingIds.has(mid) && mid !== session.user.id);
  if (toAdd.length === 0) {
    return NextResponse.json(conversation);
  }

  const validMembers = await prisma.member.findMany({
    where: { id: { in: toAdd } },
    select: { id: true },
  });
  const validIds = validMembers.map((m) => m.id);

  await prisma.groupConversationMember.createMany({
    data: validIds.map((memberId) => ({ conversationId: id, memberId })),
    skipDuplicates: true,
  });

  const updated = await prisma.groupConversation.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      members: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
      },
    },
  });

  return NextResponse.json(updated);
}
