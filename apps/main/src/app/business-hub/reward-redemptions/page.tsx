import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "database";
import { getServerSession } from "@/lib/auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";

export const dynamic = "force-dynamic";

function statusLabel(fulfillmentStatus: string | null, storeOrderId: string | null) {
  if (fulfillmentStatus === "paid") return "Ready to fulfill / ship";
  if (fulfillmentStatus === "pending_checkout") {
    return storeOrderId ? "Payment pending (legacy)" : "Awaiting shipping address";
  }
  return fulfillmentStatus ?? (storeOrderId ? "In progress" : "Recorded");
}

export default async function BusinessRewardRedemptionsPage() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/business-hub/reward-redemptions");
  }
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const hasAccess = isAdmin || (await hasBusinessHubAccess(session.user.id));
  if (!hasAccess) {
    redirect("/business-hub");
  }

  const businesses = await prisma.business.findMany({
    where: { memberId: session.user.id },
    select: { id: true, name: true },
  });
  const businessIds = businesses.map((b) => b.id);
  const businessNameById = Object.fromEntries(businesses.map((b) => [b.id, b.name]));

  const redemptionInclude = {
    member: {
      select: { firstName: true, lastName: true, email: true, phone: true },
    },
    reward: {
      select: {
        title: true,
        needsShipping: true,
        businessId: true,
        business: { select: { name: true } },
      },
    },
  };

  const redemptions = isAdmin
    ? await prisma.rewardRedemption.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: redemptionInclude,
      })
    : businessIds.length === 0
      ? []
      : await prisma.rewardRedemption.findMany({
          where: { reward: { businessId: { in: businessIds } } },
          orderBy: { createdAt: "desc" },
          take: 300,
          include: redemptionInclude,
        });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="mb-8">
          <Link
            href="/business-hub"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Business Hub
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
          Reward Redemptions
        </h1>
        <p className="text-gray-600 mb-8">
          {isAdmin
            ? "All reward redemptions on the platform (admin view). For shipping rewards, contact details are shown for fulfillment. Members are never charged shipping for rewards."
            : "Members who redeemed rewards tied to your businesses. For shipping rewards, contact details are shown so you can fulfill and ship. Members are never charged shipping for rewards."}
        </p>

        {redemptions.length === 0 ? (
          <p className="text-gray-500">No redemptions yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--color-primary)" }}>
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-[var(--color-section-alt)]">
                  <th className="text-left p-3 font-semibold">When</th>
                  <th className="text-left p-3 font-semibold">Business</th>
                  <th className="text-left p-3 font-semibold">Reward</th>
                  <th className="text-left p-3 font-semibold">Member</th>
                  <th className="text-left p-3 font-semibold">Email</th>
                  <th className="text-left p-3 font-semibold">Phone</th>
                  <th className="text-left p-3 font-semibold">Status</th>
                  <th className="text-left p-3 font-semibold">Order</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.id} className="border-t border-gray-200">
                    <td className="p-3 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="p-3">
                      {r.reward.business?.name ?? businessNameById[r.reward.businessId] ?? "—"}
                    </td>
                    <td className="p-3">{r.reward.title}</td>
                    <td className="p-3">
                      {r.member.firstName} {r.member.lastName}
                    </td>
                    <td className="p-3 break-all">{r.reward.needsShipping ? r.contactEmail ?? r.member.email : "—"}</td>
                    <td className="p-3 whitespace-nowrap">{r.reward.needsShipping ? r.contactPhone ?? r.member.phone ?? "—" : "—"}</td>
                    <td className="p-3">{statusLabel(r.fulfillmentStatus, r.storeOrderId)}</td>
                    <td className="p-3">
                      {r.storeOrderId ? (
                        <Link
                          href={`/seller-hub/orders/${r.storeOrderId}`}
                          className="hover:underline font-medium"
                          style={{ color: "var(--color-primary)" }}
                        >
                          View order
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
