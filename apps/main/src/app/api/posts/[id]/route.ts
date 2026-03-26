import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { isFeedPostRenderable } from "@/lib/feed-post-visible";
import { hydrateFeedPostRows, feedPostListInclude } from "@/lib/hydrate-feed-post-rows";
import { canViewerSeeFeedItem } from "@/lib/feed-post-viewer-access";
import { z } from "zod";

/** Avoid edge/CDN serving a cached HTML shell for API responses. */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionForApi(_req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const [friendships, myGroups, raw] = await Promise.all([
    prisma.friendRequest.findMany({
      where: {
        OR: [
          { requesterId: session.user.id, status: "accepted" },
          { addresseeId: session.user.id, status: "accepted" },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.groupMember.findMany({
      where: { memberId: session.user.id },
      select: { groupId: true },
    }),
    prisma.post.findUnique({
      where: { id },
      include: feedPostListInclude,
    }),
  ]);

  if (!raw) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const friendIds = new Set(
    friendships.flatMap((f) => (f.requesterId === session.user.id ? f.addresseeId : f.requesterId))
  );
  const groupIds = new Set(myGroups.map((g) => g.groupId));

  const [hydrated] = await hydrateFeedPostRows([raw], session.user.id);
  if (!hydrated || !isFeedPostRenderable(hydrated as unknown as Parameters<typeof isFeedPostRenderable>[0])) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ok = canViewerSeeFeedItem(
    {
      type: hydrated.type,
      author: hydrated.author as { id?: string; privacyLevel?: string | null },
      groupId: (hydrated.groupId as string | null) ?? null,
      sourcePost: hydrated.sourcePost as {
        author?: { id?: string; privacyLevel?: string | null };
        groupId?: string | null;
      } | null,
    },
    session.user.id,
    friendIds,
    groupIds
  );

  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ post: hydrated });
}

const patchSchema = z.object({
  content: z.string().max(5000).optional().nullable(),
  photos: z.array(z.string()).optional(),
  videos: z.array(z.string()).optional(),
  links: z
    .array(z.object({ url: z.string().optional(), title: z.string().optional() }))
    .optional(),
  tags: z.array(z.string()).optional(),
  taggedMemberIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = patchSchema.parse(body);

    let contentValue: string | null | undefined;
    if (data.content !== undefined) {
      contentValue = data.content === null ? null : (data.content ?? "").trim() || null;
      if (contentValue && contentValue.length > 0) {
        const contentCheck = validateText(contentValue, "comment");
        if (!contentCheck.allowed) {
          await createFlaggedContent({
            contentType: "post",
            contentId: id,
            reason: "slur",
            snippet: contentValue.slice(0, 500),
            authorId: session.user.id,
          });
          return NextResponse.json(
            { error: contentCheck.reason ?? "This content contains language that is not allowed." },
            { status: 400 }
          );
        }
      }
    }

    let taggedMemberIds: string[] | undefined;
    if (data.taggedMemberIds !== undefined) {
      const rawTaggedIds = data.taggedMemberIds;
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
          friendships.map((f) => (f.requesterId === session.user.id ? f.addresseeId : f.requesterId))
        );
        taggedMemberIds = rawTaggedIds.filter((tid) => validIds.has(tid) && tid !== session.user.id);
      } else {
        taggedMemberIds = [];
      }
    }

    const photos =
      data.photos !== undefined ? data.photos.filter((p): p is string => typeof p === "string" && p.length > 0) : undefined;
    const videos =
      data.videos !== undefined ? data.videos.filter((v): v is string => typeof v === "string" && v.length > 0) : undefined;
    const links =
      data.links !== undefined
        ? data.links.filter((l) => l?.url && typeof l.url === "string" && l.url.length > 0)
        : undefined;

    const updated = await prisma.post.update({
      where: { id },
      data: {
        ...(contentValue !== undefined ? { content: contentValue } : {}),
        ...(photos !== undefined ? { photos } : {}),
        ...(videos !== undefined ? { videos } : {}),
        ...(links !== undefined ? { links: links.length ? (links as object) : undefined } : {}),
        ...(taggedMemberIds !== undefined ? { taggedMemberIds } : {}),
      },
    });

    if (data.tags !== undefined) {
      await prisma.postTag.deleteMany({ where: { postId: id } });
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
      if (tagIds.length) {
        await prisma.postTag.createMany({
          data: tagIds.map((tagId) => ({ postId: id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json({ post: updated });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[PATCH /api/posts/[id]]", e);
    return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await prisma.post.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/posts/[id]]", e);
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
  }
}
