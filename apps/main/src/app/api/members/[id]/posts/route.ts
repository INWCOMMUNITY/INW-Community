import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { authOptions } from "@/lib/auth";
import { canViewerSeeFullMemberProfile } from "@/lib/member-profile-access";
import { hasBlockBetween } from "@/lib/member-block";
import { memberIsSiteVisible } from "@/lib/member-public-visibility";
import { feedPostListInclude, hydrateFeedPostRows } from "@/lib/hydrate-feed-post-rows";
import { galleryPhotosFromHydratedPost } from "@/lib/member-gallery-photos";

/**
 * GET /api/members/[id]/posts?limit=30&cursor=...
 * Posts with gallery images for the member profile photo grid.
 * Visibility matches profile: only if viewer can see full profile (self, or friend when profile is friends_only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: memberId } = await params;
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  const viewerId = session?.user?.id ?? null;

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, privacyLevel: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (!(await memberIsSiteVisible(memberId))) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (viewerId && (await hasBlockBetween(viewerId, memberId))) {
    return NextResponse.json({ error: "Not available", blocked: true }, { status: 404 });
  }

  const canSeeFullProfile = await canViewerSeeFullMemberProfile(
    viewerId,
    memberId,
    member.privacyLevel
  );

  if (!canSeeFullProfile) {
    return NextResponse.json({ posts: [], nextCursor: null });
  }

  const fetchCount = Math.min(Math.max(limit * 4, 24), 100);
  const posts = await prisma.post.findMany({
    where: {
      authorId: memberId,
      OR: [
        { photos: { isEmpty: false } },
        { sourcePostId: { not: null } },
        { sourceBlogId: { not: null } },
        { sourceStoreItemId: { not: null } },
        { sourceEventId: { not: null } },
        { sourceListingCollectionId: { not: null } },
      ],
    },
    include: feedPostListInclude,
    orderBy: { createdAt: "desc" },
    take: fetchCount + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const fetchedHasMore = posts.length > fetchCount;
  const windowItems = fetchedHasMore ? posts.slice(0, fetchCount) : posts;

  const hydrated = await hydrateFeedPostRows(windowItems, viewerId ?? "");
  const withPhotos = hydrated
    .map((p) => {
      const photos = galleryPhotosFromHydratedPost(p);
      return { ...p, photos };
    })
    .filter((p) => p.photos.length > 0);

  const usedEventIds = new Set(
    hydrated
      .map((p) => (typeof p.sourceEventId === "string" ? p.sourceEventId : null))
      .filter((id): id is string => !!id)
  );

  const eventWhere = {
    photos: { isEmpty: false },
    OR: [{ memberId }, { business: { memberId } }],
    ...(viewerId === memberId ? {} : { status: "approved" }),
    ...(usedEventIds.size > 0 ? { id: { notIn: [...usedEventIds] } } : {}),
  };

  const eventRows =
    cursor
      ? []
      : await prisma.event.findMany({
          where: eventWhere,
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            title: true,
            slug: true,
            photos: true,
            createdAt: true,
            date: true,
            time: true,
            endTime: true,
            location: true,
            city: true,
            member: {
              select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
            },
          },
        });

  const memberAuthor = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
  });

  const eventItems = eventRows.map((e) => ({
    id: `event-${e.id}`,
    type: "shared_event",
    content: e.title,
    photos: (e.photos ?? []).filter((u) => typeof u === "string" && u.trim().length > 0),
    createdAt: e.createdAt,
    author:
      e.member ??
      memberAuthor ?? {
        id: memberId,
        firstName: "",
        lastName: "",
        profilePhotoUrl: null,
      },
    sourceEvent: {
      id: e.id,
      slug: e.slug,
      title: e.title,
      date: e.date,
      time: e.time,
      endTime: e.endTime,
      location: e.location,
      city: e.city,
      photos: e.photos,
    },
  }));

  const merged = [...withPhotos, ...eventItems].sort((a, b) => {
    const ta = new Date(a.createdAt as Date | string).getTime();
    const tb = new Date(b.createdAt as Date | string).getTime();
    return tb - ta;
  });

  const feedItems = merged.slice(0, limit);
  const lastId = feedItems[feedItems.length - 1]?.id;
  const lastIdStr = typeof lastId === "string" ? lastId : null;
  const nextCursor =
    merged.length > limit && lastIdStr && !lastIdStr.startsWith("event-")
      ? lastIdStr
      : fetchedHasMore
        ? windowItems[windowItems.length - 1]?.id ?? null
        : null;

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
