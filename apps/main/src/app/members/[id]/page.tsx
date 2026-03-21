import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { MemberProfile } from "@/components/MemberProfile";
import { MemberPostsGrid } from "@/components/MemberPostsGrid";
import { resolveMemberMediaUrl } from "@/lib/member-media-url";

export const dynamic = "force-dynamic";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

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
        include: { badge: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  if (!member) notFound();

  // All profiles are public; privacyLevel is kept for future use (e.g. photos section friends-only).
  const blogs = await prisma.blog.findMany({
    where: { memberId: member.id, status: "approved" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const favoriteBusinesses = await prisma.savedItem.findMany({
    where: { memberId: member.id, type: "business" },
    select: { referenceId: true },
  }).then((items) =>
    items.length > 0
      ? prisma.business.findMany({
          where: { id: { in: items.map((i) => i.referenceId) } },
          select: { id: true, name: true, slug: true, logoUrl: true },
        })
      : []
  );

  let isFriend = false;
  let pendingFriendRequest: "incoming" | "outgoing" | null = null;
  if (session?.user?.id && session.user.id !== member.id) {
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { requesterId: session.user.id, addresseeId: member.id },
          { requesterId: member.id, addresseeId: session.user.id },
        ],
      },
    });
    if (friendship) {
      if (friendship.status === "accepted") isFriend = true;
      else if (friendship.requesterId === session.user.id) pendingFriendRequest = "outgoing";
      else pendingFriendRequest = "incoming";
    }
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <MemberProfile
          member={{
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            profilePhotoUrl: resolveMemberMediaUrl(member.profilePhotoUrl),
            bio: member.bio,
            city: member.city,
            allTimePointsEarned: member.allTimePointsEarned ?? 0,
          }}
          badges={member.memberBadges?.map((mb) => mb.badge) ?? []}
          blogs={blogs}
          favoriteBusinesses={favoriteBusinesses}
          sessionUserId={session?.user?.id ?? null}
          isOwnProfile={session?.user?.id === member.id}
          isFriend={isFriend}
          pendingFriendRequest={pendingFriendRequest}
        />
        <MemberPostsGrid memberId={member.id} />
      </div>
    </section>
  );
}
