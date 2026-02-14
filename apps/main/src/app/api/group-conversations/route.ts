import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.groupConversation.findMany({
    where: {
      members: {
        some: { memberId: session.user.id },
      },
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      members: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, senderId: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(conversations);
}

const postBodySchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(50),
  name: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof postBodySchema>;
  try {
    const body = await req.json();
    data = postBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const uniqueMemberIds = [...new Set([session.user.id, ...data.memberIds])];
  const members = await prisma.member.findMany({
    where: { id: { in: uniqueMemberIds } },
    select: { id: true },
  });
  const foundIds = new Set(members.map((m) => m.id));
  const invalidIds = uniqueMemberIds.filter((id) => !foundIds.has(id));
  if (invalidIds.length > 0) {
    return NextResponse.json({ error: "Invalid member IDs" }, { status: 400 });
  }

  const conversation = await prisma.groupConversation.create({
    data: {
      name: data.name?.trim() || null,
      createdById: session.user.id,
      members: {
        create: uniqueMemberIds.map((memberId) => ({ memberId })),
      },
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      members: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
      },
      messages: true,
    },
  });

  return NextResponse.json(conversation);
}
