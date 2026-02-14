import { prisma } from "database";
import Link from "next/link";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.ADMIN_CODE ?? process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

export default async function AdminSubscriptionsPage() {
  const [subscriptions, stripeStats] = await Promise.all([
    prisma.subscription.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        member: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
    fetch(`${MAIN_URL}/api/admin/stripe-stats`, {
      headers: { "x-admin-code": ADMIN_CODE },
      next: { revalidate: 60 },
    })
      .then((r) => r.json())
      .catch(() => ({ subscriptionRevenueThisMonthCents: 0, subscriptionRevenueCents: 0 })),
  ]);

  const activeCount = subscriptions.filter((s) => s.status === "active").length;
  const thisMonthCents = stripeStats?.subscriptionRevenueThisMonthCents ?? 0;
  const totalCents = stripeStats?.subscriptionRevenueCents ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Subscriptions</h1>
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Total Monthly Income (This Month)</p>
          <p className="text-2xl font-bold">${(thisMonthCents / 100).toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-1">From Stripe – subscription invoices paid this month</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">All-Time Subscription Revenue</p>
          <p className="text-2xl font-bold">${(totalCents / 100).toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-1">Total from Stripe</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Active Subscriptions</p>
          <p className="text-2xl font-bold">{activeCount}</p>
          <p className="text-xs text-gray-500 mt-1">Out of {subscriptions.length} total</p>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Period end</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">
                  <Link href={`/dashboard/members`} className="hover:underline" style={{ color: "#505542" }}>
                    {s.member.firstName} {s.member.lastName}
                  </Link>
                  <span className="text-gray-500 text-sm block">{s.member.email}</span>
                </td>
                <td className="px-4 py-2 capitalize">{s.plan}</td>
                <td className="px-4 py-2">{s.status}</td>
                <td className="px-4 py-2 text-sm text-gray-500">
                  {s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
