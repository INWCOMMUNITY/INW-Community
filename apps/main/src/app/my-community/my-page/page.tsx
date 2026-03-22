import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { MemberProfile } from "@/components/MemberProfile";
import { resolveMemberMediaUrl } from "@/lib/member-media-url";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/my-community/my-page");

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
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

  if (!member) redirect("/my-community");

  const badges =
    member.memberBadges?.map((mb) => ({
      id: mb.badge.id,
      name: mb.badge.name,
      slug: mb.badge.slug,
      description: mb.badge.description,
    })) ?? [];

  const blogs = await prisma.blog.findMany({
    where: { memberId: member.id, status: "approved" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const favoriteBusinesses = await prisma.savedItem
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
    );

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
          bio: member.bio,
          city: member.city,
          allTimePointsEarned: member.allTimePointsEarned ?? 0,
        }}
        canSeeFullProfile
        badges={badges}
        blogs={blogs}
        favoriteBusinesses={favoriteBusinesses}
        sessionUserId={session.user.id}
        isOwnProfile
        isFriend={false}
        pendingFriendRequest={null}
        incomingFriendRequestId={null}
        editProfileHref="/my-community/profile"
        backHref="/my-community"
      />
        </div>
      </div>
    </section>
  );
}
