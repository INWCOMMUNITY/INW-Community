import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const postSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  coverImageUrl: z
    .string()
    .refine((v) => !v || v.startsWith("/") || v.startsWith("http"), "Invalid cover image URL")
    .optional()
    .nullable(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const category = searchParams.get("category") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 100);

  const where: { name?: { contains: string; mode: "insensitive" }; category?: string } = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (category) where.category = category;

  const groups = await prisma.group.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      _count: { select: { members: true, groupPosts: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let membershipMap: Record<string, { role: string }> = {};
  if (session?.user?.id && groups.length > 0) {
    const memberships = await prisma.groupMember.findMany({
      where: {
        groupId: { in: groups.map((g) => g.id) },
        memberId: session.user.id,
      },
      select: { groupId: true, role: true },
    });
    membershipMap = Object.fromEntries(memberships.map((m) => [m.groupId, { role: m.role }]));
  }

  const groupsWithMembership = groups.map((g) => {
    const membership = membershipMap[g.id];
    return {
      ...g,
      isMember: !!membership,
      memberRole: membership?.role ?? null,
    };
  });

  return NextResponse.json({ groups: groupsWithMembership });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot create groups with completely private account" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = postSchema.parse(body);

    let slug = slugify(data.name);
    let suffix = 0;
    while (await prisma.group.findUnique({ where: { slug } })) {
      slug = `${slugify(data.name)}-${++suffix}`;
    }

    const group = await prisma.group.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        category: data.category ?? null,
        coverImageUrl: data.coverImageUrl ?? null,
        slug,
        createdById: session.user.id,
      },
    });

    await prisma.groupMember.create({
      data: {
        groupId: group.id,
        memberId: session.user.id,
        role: "admin",
      },
    });

    const { awardAdminBadge } = await import("@/lib/badge-award");
    awardAdminBadge(session.user.id).catch(() => {});

    return NextResponse.json({ group });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
