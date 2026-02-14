import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export default async function CommunityPointsPage() {
  const session = await getServerSession(authOptions);
  const member = session?.user?.id
    ? await prisma.member.findUnique({
        where: { id: session.user.id },
        select: { points: true },
      })
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Community Points</h1>
      {member ? (
        <>
          <p className="text-lg mb-4">Your balance: <strong>{member.points}</strong> points</p>
          <p className="text-gray-600 mb-4">
            Earn points by supporting local—saving businesses, attending events, using coupons, and engaging with the community.
          </p>
          <Link href="/my-community/rewards" className="btn inline-block">
            Redeem rewards
          </Link>
        </>
      ) : (
        <p className="text-gray-600">Sign in to view your Community Points.</p>
      )}
    </div>
  );
}
