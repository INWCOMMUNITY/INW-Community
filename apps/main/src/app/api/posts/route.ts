import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const postSchema = z.object({
  content: z.string().max(5000).optional().nullable(),
  photos: z.array(z.string()).optional().default([]),
  videos: z.array(z.string()).optional().default([]),
  links: z
    .array(z.object({ url: z.string().optional(), title: z.string().optional() }))
    .optional()
    .default([]),
  groupId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]), // tag names or slugs
  taggedMemberIds: z.array(z.string()).optional().default([]),
  sharedItemType: z.enum(["business", "coupon", "reward", "store_item"]).optional(),
  sharedItemId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot post with completely private account" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = postSchema.parse(body);

    let type = "personal";
    let groupId: string | null = null;
    let sourceBusinessId: string | null = null;
    let sourceCouponId: string | null = null;
    let sourceRewardId: string | null = null;
    let sourceStoreItemId: string | null = null;

    if (data.groupId) {
      const membership = await prisma.groupMember.findUnique({
        where: {
          groupId_memberId: { groupId: data.groupId, memberId: session.user.id },
        },
      });
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
      }
      type = "group";
      groupId = data.groupId;
    }

    if (data.sharedItemType && data.sharedItemId) {
      type = `shared_${data.sharedItemType}` as "shared_business" | "shared_coupon" | "shared_reward" | "shared_store_item";
      if (data.sharedItemType === "business") sourceBusinessId = data.sharedItemId;
      else if (data.sharedItemType === "coupon") sourceCouponId = data.sharedItemId;
      else if (data.sharedItemType === "reward") sourceRewardId = data.sharedItemId;
      else if (data.sharedItemType === "store_item") sourceStoreItemId = data.sharedItemId;
    }

    const photos = (data.photos ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
    const videos = (data.videos ?? []).filter((v): v is string => typeof v === "string" && v.length > 0);
    const links = (data.links ?? []).filter((l) => l?.url && typeof l.url === "string" && l.url.length > 0);

    const rawTaggedIds = (data as { taggedMemberIds?: string[] }).taggedMemberIds ?? [];
    let taggedMemberIds: string[] = [];
    if (rawTaggedIds.length) {
      const friendships = await prisma.friendRequest.findMany({
        where: {
          status: "accepted",
          OR: [
            { requesterId: session.user.id, addresseeId: { in: rawTaggedIds } },
            { addresseeId: session.user.id, requesterId: { in: rawTaggedIds } },
          ],
        },
      });
      const validIds = new Set(
        friendships.map((f) =>
          f.requesterId === session.user.id ? f.addresseeId : f.requesterId
        )
      );
      taggedMemberIds = rawTaggedIds.filter((id) => validIds.has(id) && id !== session.user.id);
    }

    const post = await prisma.post.create({
      data: {
        type,
        authorId: session.user.id,
        content: data.content ?? null,
        photos,
        videos,
        links: links.length ? (links as object) : undefined,
        groupId,
        taggedMemberIds,
        sourceBusinessId,
        sourceCouponId,
        sourceRewardId,
        sourceStoreItemId,
      },
    });

    if (data.tags?.length) {
      const tagIds: string[] = [];
      for (const t of data.tags) {
        const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!slug) continue;
        let tag = await prisma.tag.findUnique({ where: { slug } });
        if (!tag) {
          tag = await prisma.tag.create({
            data: { name: t.trim(), slug },
          });
        }
        tagIds.push(tag.id);
      }
      await prisma.postTag.createMany({
        data: tagIds.map((tagId) => ({ postId: post.id, tagId })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ post });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
