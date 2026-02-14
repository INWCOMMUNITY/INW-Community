import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { MemberProfile } from "@/components/MemberProfile";

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
    },
  });

  if (!member) notFound();

  if (member.privacyLevel === "completely_private") {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">This profile is private</h1>
          <p className="text-gray-600">This member has set their profile to completely private.</p>
        </div>
      </section>
    );
  }

  if (member.privacyLevel === "friends_only") {
    if (!session?.user?.id) {
      return (
        <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <div className="max-w-[var(--max-width)] mx-auto text-center">
            <h1 className="text-2xl font-bold mb-4">Friends only</h1>
            <p className="text-gray-600 mb-4">This profile is visible only to friends. Sign in and send a friend request to view.</p>
            <Link href={`/login?callbackUrl=/members/${id}`} className="btn">Sign in</Link>
          </div>
        </section>
      );
    }
    if (session.user.id === member.id) {
      // Viewing own profile - show it
    } else {
      const friendship = await prisma.friendRequest.findFirst({
        where: {
          OR: [
            { requesterId: session.user.id, addresseeId: member.id },
            { requesterId: member.id, addresseeId: session.user.id },
          ],
          status: "accepted",
        },
      });
      if (!friendship) {
        return (
          <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
            <div className="max-w-[var(--max-width)] mx-auto text-center">
              <h1 className="text-2xl font-bold mb-4">Friends only</h1>
              <p className="text-gray-600 mb-4">This profile is visible only to friends. Send a friend request to view.</p>
            </div>
          </section>
        );
      }
    }
  }

  const blogs = member.privacyLevel === "public" || (session?.user?.id === member.id)
    ? await prisma.blog.findMany({
        where: { memberId: member.id, status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

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
  let isFollowing = false;
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
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: member.id,
        },
      },
    });
    isFollowing = !!follow;
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <MemberProfile
          member={member}
          blogs={blogs}
          favoriteBusinesses={favoriteBusinesses}
          sessionUserId={session?.user?.id ?? null}
          isOwnProfile={session?.user?.id === member.id}
          isFriend={isFriend}
          isFollowing={isFollowing}
          pendingFriendRequest={pendingFriendRequest}
        />
      </div>
    </section>
  );
}
