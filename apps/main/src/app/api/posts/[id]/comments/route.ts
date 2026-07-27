import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";
import { validateText } from "@/lib/content-moderation";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import {
  canViewerSeeFeedItem,
  canUnauthenticatedViewerSeeFeedItem,
} from "@/lib/feed-post-viewer-access";
import { z } from "zod";

const bodySchema = z.object({
  content: z.string().max(2000).default(""),
  photos: z.array(z.string().min(1)).max(6).optional().default([]),
  parentId: z.string().optional(),
}).refine(
  (data) => (data.content?.trim() ?? "").length > 0 || (data.photos?.length ?? 0) > 0,
  { message: "Comment must have text or photos" }
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, privacyLevel: true } },
    },
  });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let sourcePost: { author: { id: string; privacyLevel: string | null } | null; groupId: string | null } | null = null;
  if (post.sourcePostId) {
    sourcePost = await prisma.post.findUnique({
      where: { id: post.sourcePostId },
      select: {
        author: { select: { id: true, privacyLevel: true } },
        groupId: true,
      },
    });
  }
  const feedItem = { ...post, sourcePost };

  const session = await getSessionForApi(req as NextRequest);

  if (session?.user?.id) {
    const viewerId = session.user.id;
    const [friendships, myGroups] = await Promise.all([
      prisma.friendRequest.findMany({
        where: {
          OR: [
            { requesterId: viewerId, status: "accepted" },
            { addresseeId: viewerId, status: "accepted" },
          ],
        },
        select: { requesterId: true, addresseeId: true },
      }),
      prisma.groupMember.findMany({
        where: { memberId: viewerId },
        select: { groupId: true },
      }),
    ]);
    const friendIds = friendships.map((f) =>
      f.requesterId === viewerId ? f.addresseeId : f.requesterId
    );
    const viewerFriendIdSet = new Set(friendIds);
    const viewerGroupIdSet = new Set(myGroups.map((g) => g.groupId));
    if (!canViewerSeeFeedItem(feedItem, viewerId, viewerFriendIdSet, viewerGroupIdSet)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
  } else {
    if (!canUnauthenticatedViewerSeeFeedItem(feedItem)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
  }

  let blockedIds: Set<string> | null = null;
  if (session?.user?.id) {
    blockedIds = await getBlockedMemberIds(session.user.id);
  }

  const topLevelWhere = {
    postId: id,
    parentId: null,
    ...(blockedIds && blockedIds.size > 0 ? { memberId: { notIn: [...blockedIds] } } : {}),
  };

  const topLevelComments = await prisma.postComment.findMany({
    where: topLevelWhere,
    include: {
      member: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      parent: {
        select: { id: true, memberId: true, member: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = topLevelComments.length > limit;
  const topPage = hasMore ? topLevelComments.slice(0, limit) : topLevelComments;
  const nextCursor = hasMore ? topPage[topPage.length - 1]?.id ?? null : null;

  const topIds = topPage.map((c) => c.id);

  const replies = topIds.length > 0
    ? await prisma.postComment.findMany({
        where: {
          postId: id,
          parentId: { in: topIds },
          ...(blockedIds && blockedIds.size > 0 ? { memberId: { notIn: [...blockedIds] } } : {}),
        },
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
          },
          parent: {
            select: { id: true, memberId: true, member: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const allComments = [...topPage, ...replies];
  const commentIds = allComments.map((c) => c.id);
  const [likeCounts, likedByMe] = await Promise.all([
    commentIds.length > 0
      ? prisma.postCommentLike.groupBy({
          by: ["commentId"],
          where: { commentId: { in: commentIds } },
          _count: { commentId: true },
        })
      : [],
    session?.user?.id && commentIds.length > 0
      ? prisma.postCommentLike.findMany({
          where: { commentId: { in: commentIds }, memberId: session.user.id },
          select: { commentId: true },
        })
      : [],
  ]);
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.commentId, l._count.commentId]));
  const likedSet = new Set(likedByMe.map((l) => l.commentId));

  const result = allComments.map((c) => ({
    ...c,
    likeCount: likeCountMap[c.id] ?? 0,
    liked: likedSet.has(c.id),
    parentAuthorName: c.parent
      ? `${c.parent.member.firstName ?? ""} ${c.parent.member.lastName ?? ""}`.trim()
      : null,
  }));

  return NextResponse.json({ comments: result, nextCursor });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      authorId: true,
      sourceBusinessId: true,
      sourcePostId: true,
      groupId: true,
      author: { select: { id: true, privacyLevel: true } },
    },
  });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let sourcePostForAccess: { author: { id: string; privacyLevel: string | null } | null; groupId: string | null } | null = null;
  if (post.sourcePostId) {
    sourcePostForAccess = await prisma.post.findUnique({
      where: { id: post.sourcePostId },
      select: {
        author: { select: { id: true, privacyLevel: true } },
        groupId: true,
      },
    });
  }

  const [friendships, myGroups] = await Promise.all([
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
  ]);
  const friendIds = friendships.map((f) =>
    f.requesterId === session.user.id ? f.addresseeId : f.requesterId
  );
  const feedItemForAccess = { ...post, sourcePost: sourcePostForAccess };
  if (!canViewerSeeFeedItem(feedItemForAccess, session.user.id, new Set(friendIds), new Set(myGroups.map((g) => g.groupId)))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { content, photos, parentId } = bodySchema.parse(body);

    let parentCommentAuthorId: string | null = null;
    if (parentId) {
      const parent = await prisma.postComment.findFirst({
        where: { id: parentId, postId: id },
        select: { id: true, memberId: true },
      });
      if (!parent) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
      }
      parentCommentAuthorId = parent.memberId;
    }

    const contentTrimmed = (content ?? "").trim() || " ";
    const contentCheck = validateText(contentTrimmed, "comment");
    if (!contentCheck.allowed) {
      return NextResponse.json({ error: contentCheck.reason ?? "Comment not allowed." }, { status: 400 });
    }

    const comment = await prisma.postComment.create({
      data: {
        postId: id,
        ...(parentId ? { parentId } : {}),
        memberId: session.user.id,
        content: contentTrimmed,
        photos: photos ?? [],
      },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
        },
      },
    });

    let notifyMemberId: string | null = null;
    let pushTitle = "";
    if (parentId && parentCommentAuthorId && parentCommentAuthorId !== session.user.id) {
      notifyMemberId = parentCommentAuthorId;
      pushTitle = "New reply to your comment!";
    } else if (!parentId && post.authorId !== session.user.id) {
      notifyMemberId = post.authorId;
      pushTitle = "New comment on your post!";
    }
    if (notifyMemberId) {
      const preview =
        contentTrimmed.length > 0
          ? `${comment.member.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
          : `${comment.member.firstName} commented on your post — tap to view.`;
      const { sendPushNotification } = await import("@/lib/send-push-notification");
      sendPushNotification(notifyMemberId, {
        title: pushTitle,
        body: preview,
        data: { screen: "post", postId: id },
        category: "comments",
      }).catch(() => {});
    }

    if (!parentId && post.sourceBusinessId && post.sourceBusinessId.length > 0) {
      const biz = await prisma.business.findUnique({
        where: { id: post.sourceBusinessId },
        select: { memberId: true, name: true },
      });
      if (
        biz &&
        biz.memberId !== session.user.id &&
        biz.memberId !== notifyMemberId
      ) {
        const previewBiz =
          contentTrimmed.length > 0
            ? `${comment.member.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
            : `${comment.member.firstName} commented on a post about your business — tap to view.`;
        const { sendPushNotification } = await import("@/lib/send-push-notification");
        sendPushNotification(biz.memberId, {
          title: "New comment on your business post!",
          body: previewBiz,
          data: { screen: "post", postId: id },
          category: "comments",
        }).catch(() => {});
      }
    }

    return NextResponse.json(comment);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors?.[0]?.message ?? e.message ?? "Invalid comment";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const err = e as Error;
    console.error("[POST /api/posts/[id]/comments]", err);
    const message =
      process.env.NODE_ENV === "development"
        ? err.message ?? "Failed to create comment"
        : "Failed to create comment. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
