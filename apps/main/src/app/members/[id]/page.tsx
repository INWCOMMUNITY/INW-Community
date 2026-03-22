import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { MemberProfile } from "@/components/MemberProfile";
import { resolveMemberMediaUrl } from "@/lib/member-media-url";
import { canViewerSeeFullMemberProfile } from "@/lib/member-profile-access";

export const dynamic = "force-dynamic";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const viewerId = session?.user?.id ?? null;

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      bio: true,
      city: true,
      privacyLevel: true,
      allTimePointsEarned: true,
      memberBadges: {
        include: { badge: { select: { id: true, name: true, slug: true, description: true } } },
      },
    },
  });

  if (!member) notFound();

  const canSeeFull = await canViewerSeeFullMemberProfile(viewerId, member.id, member.privacyLevel);

  const blogs = canSeeFull
    ? await prisma.blog.findMany({
        where: { memberId: member.id, status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  const favoriteBusinesses = canSeeFull
    ? await prisma.savedItem
        .findMany({
          where: { memberId: member.id, type: "business" },
          select: { referenceId: true },
        })
        .then((items) =>
          items.length > 0
            ? prisma.business.findMany({
                where: { id: { in: items.map((i) => i.referenceId) } },
                select: { id: true, name: true, slug: true, logoUrl: true },
              })
            : []
        )
    : [];

  let isFriend = false;
  let pendingFriendRequest: "incoming" | "outgoing" | null = null;
  let incomingFriendRequestId: string | null = null;

  if (viewerId && viewerId !== member.id) {
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: member.id },
          { requesterId: member.id, addresseeId: viewerId },
        ],
      },
    });
    if (friendship) {
      if (friendship.status === "accepted") isFriend = true;
      else if (friendship.status === "pending") {
        if (friendship.requesterId === viewerId) pendingFriendRequest = "outgoing";
        else {
          pendingFriendRequest = "incoming";
          incomingFriendRequestId = friendship.id;
        }
      }
    }
  }

  const badges =
    canSeeFull && member.memberBadges
      ? member.memberBadges.map((mb) => ({
          id: mb.badge.id,
          name: mb.badge.name,
          slug: mb.badge.slug,
          description: mb.badge.description,
        }))
      : [];

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl border-2 border-[var(--color-primary)] shadow-lg overflow-hidden bg-white">
          <MemberProfile
            member={{
              id: member.id,
              firstName: member.firstName,
              lastName: member.lastName,
              profilePhotoUrl: resolveMemberMediaUrl(member.profilePhotoUrl),
              bio: canSeeFull ? member.bio : null,
              city: member.city,
              allTimePointsEarned: member.allTimePointsEarned ?? 0,
            }}
            canSeeFullProfile={canSeeFull}
            badges={badges}
            favoriteBusinesses={favoriteBusinesses}
            blogs={blogs}
            sessionUserId={viewerId}
            isOwnProfile={viewerId === member.id}
            isFriend={isFriend}
            pendingFriendRequest={pendingFriendRequest}
            incomingFriendRequestId={incomingFriendRequestId}
          />
        </div>
      </div>
    </section>
  );
}
