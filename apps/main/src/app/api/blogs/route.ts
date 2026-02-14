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

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  categoryId: z.string().min(1),
  photos: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional().default([]),
});

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
    return NextResponse.json({ error: "Cannot post blogs with completely private account" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = bodySchema.parse(body);

    const category = await prisma.blogCategory.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    let slug = slugify(data.title);
    let suffix = 0;
    while (await prisma.blog.findUnique({ where: { slug } })) {
      slug = `${slugify(data.title)}-${++suffix}`;
    }

    const blog = await prisma.blog.create({
      data: {
        memberId: session.user.id,
        categoryId: data.categoryId,
        title: data.title,
        body: data.body,
        photos: data.photos ?? [],
        slug,
        status: "pending",
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        category: { select: { id: true, name: true, slug: true } },
      },
    });

    const tags = (data as { tags?: string[] }).tags ?? [];
    if (tags.length) {
      const tagIds: string[] = [];
      for (const t of tags) {
        const tagSlug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!tagSlug) continue;
        let tag = await prisma.tag.findUnique({ where: { slug: tagSlug } });
        if (!tag) {
          tag = await prisma.tag.create({
            data: { name: t.trim(), slug: tagSlug },
          });
        }
        tagIds.push(tag.id);
      }
      await prisma.blogTag.createMany({
        data: tagIds.map((tagId) => ({ blogId: blog.id, tagId })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json(blog);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categorySlug = searchParams.get("category");
  const status = searchParams.get("status");
  const session = await getServerSession(authOptions);

  const where: { status: string; category?: { slug: string } } = { status: "approved" };
  if (session?.user?.id && status === "pending") {
    const blogs = await prisma.blog.findMany({
      where: { status: "pending", memberId: session.user.id },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(blogs);
  }
  if (categorySlug) {
    where.category = { slug: categorySlug };
  }

  const blogs = await prisma.blog.findMany({
    where,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      category: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(blogs);
}
