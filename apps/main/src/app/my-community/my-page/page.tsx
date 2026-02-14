import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { MemberProfile } from "@/components/MemberProfile";

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
    },
  });

  if (!member) redirect("/my-community");

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
    <div>
      <MemberProfile
        member={member}
        blogs={blogs}
        favoriteBusinesses={favoriteBusinesses}
        sessionUserId={session.user.id}
        isOwnProfile
        isFriend={false}
        isFollowing={false}
        pendingFriendRequest={null}
        editProfileHref="/my-community/profile"
        friendsHref="/my-community/friends"
      />
    </div>
  );
}
