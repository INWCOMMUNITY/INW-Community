import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  coverImageUrl: z
    .string()
    .refine((v) => !v || v.startsWith("/") || v.startsWith("http"), "Invalid cover image URL")
    .optional()
    .nullable(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const { slugOrId } = await params;

  const group = await prisma.group.findFirst({
    where: isCuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      _count: { select: { members: true, groupPosts: true } },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const session = await getServerSession(authOptions);
  let isMember = false;
  let memberRole: string | null = null;
  if (session?.user?.id) {
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: group.id, memberId: session.user.id },
      },
    });
    isMember = !!membership;
    memberRole = membership?.role ?? null;
  }

  return NextResponse.json({
    ...group,
    isMember,
    memberRole,
  });
}

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

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: group.id, memberId: session.user.id },
    },
  });
  const isAdmin = group.createdById === session.user.id || membership?.role === "admin";
  if (!isAdmin) {
    return NextResponse.json({ error: "Only group admins can edit" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    const updated = await prisma.group.update({
      where: { id: group.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.coverImageUrl !== undefined && { coverImageUrl: data.coverImageUrl }),
      },
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
