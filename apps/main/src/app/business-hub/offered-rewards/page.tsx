import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "database";
import { getServerSession } from "@/lib/auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { OfferedRewardsClient } from "./ui";

export const dynamic = "force-dynamic";

export default async function OfferedRewardsPage() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/business-hub/offered-rewards");
  }
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const hasAccess = isAdmin || (await hasBusinessHubAccess(session.user.id));
  if (!hasAccess) {
    redirect("/business-hub");
  }

  const rewards = isAdmin
    ? await prisma.reward.findMany({
        include: { business: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    : await prisma.reward.findMany({
        where: { business: { memberId: session.user.id } },
        include: { business: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/business-hub/manage"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Manage
          </Link>
          <Link
            href="/business-hub/reward-redemptions"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Redeemed Rewards
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
          My Offered Rewards
        </h1>
        <p className="text-gray-600 mb-6">
          Edit or remove your rewards. Removing a reward makes it inactive (it will no longer appear in the rewards list).
        </p>

        <OfferedRewardsClient initialRewards={rewards} />
      </div>
    </section>
  );
}

