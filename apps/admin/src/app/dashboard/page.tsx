import { prisma } from "database";
import Link from "next/link";
import { DashboardTodoList } from "./DashboardTodoList";
import { DashboardQuote } from "./DashboardQuote";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.ADMIN_CODE ?? process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export default async function DashboardPage() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    membersCount,
    subscriptionsCount,
    eventsCount,
    couponsCount,
    newMembersThisMonth,
    storeOrdersThisMonth,
    orderItemsThisMonth,
    stripeStats,
  ] = await Promise.all([
    prisma.member.count(),
    prisma.subscription.count(),
    prisma.event.count(),
    prisma.coupon.count(),
    prisma.member.count({
      where: { createdAt: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.storeOrder.findMany({
      where: {
        status: "paid",
        createdAt: { gte: monthStart, lte: monthEnd },
      },
      select: { totalCents: true, shippingCostCents: true },
    }),
    prisma.orderItem.findMany({
      where: {
        order: {
          status: "paid",
          createdAt: { gte: monthStart, lte: monthEnd },
        },
      },
      select: { quantity: true },
    }),
    fetch(`${MAIN_URL}/api/admin/stripe-stats`, {
      headers: { "x-admin-code": ADMIN_CODE },
      next: { revalidate: 60 },
    })
      .then((r) => r.json())
      .catch(() => ({ subscriptionRevenueThisMonthCents: 0 })),
  ]);

  const totalSalesCents = storeOrdersThisMonth.reduce((s, o) => s + o.totalCents, 0);
  const totalShippingCents = storeOrdersThisMonth.reduce((s, o) => s + o.shippingCostCents, 0);
  const totalItemsSold = orderItemsThisMonth.reduce((s, o) => s + o.quantity, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* To Do List */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold mb-3">To Do List</h2>
        <DashboardTodoList />
      </div>

      {/* Top Analytics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Money Made From Subscriptions</p>
          <p className="text-2xl font-bold">
            ${((stripeStats?.subscriptionRevenueThisMonthCents ?? 0) / 100).toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 mt-1">This month (from Stripe)</p>
          <Link href="/dashboard/subscriptions" className="text-sm hover:underline mt-1 block" style={{ color: "#505542" }}>
            View
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">This Month&apos;s Growth</p>
          <p className="text-2xl font-bold">{newMembersThisMonth}</p>
          <p className="text-xs text-gray-500 mt-1">New members this month</p>
          <Link href="/dashboard/members" className="text-sm hover:underline mt-1 block" style={{ color: "#505542" }}>
            View
          </Link>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">App Downloads</p>
          <p className="text-2xl font-bold">0</p>
          <p className="text-xs text-gray-500 mt-1">Placeholder</p>
        </div>
      </div>

      {/* Quote of the Week */}
      <div className="bg-white rounded-lg shadow p-4">
        <DashboardQuote />
      </div>

      {/* Store Front */}
      <div>
        <h2 className="text-lg font-bold mb-4">Store Front</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Total Sales This Month</p>
            <p className="text-2xl font-bold">${(totalSalesCents / 100).toFixed(2)}</p>
            <Link href="/dashboard/sellers" className="text-sm hover:underline mt-1 block" style={{ color: "#505542" }}>
              View
            </Link>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Total Items Sold</p>
            <p className="text-2xl font-bold">{totalItemsSold}</p>
            <Link href="/dashboard/sellers" className="text-sm hover:underline mt-1 block" style={{ color: "#505542" }}>
              View
            </Link>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Shipping Costs</p>
            <p className="text-2xl font-bold">${(totalShippingCents / 100).toFixed(2)}</p>
            <Link href="/dashboard/sellers" className="text-sm hover:underline mt-1 block" style={{ color: "#505542" }}>
              View
            </Link>
          </div>
        </div>
      </div>

      {/* Editor Mode */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold mb-2">Editor Mode</h2>
        <p className="text-gray-600 text-sm mb-4">
          Edit the main site layout, sections, and content. Changes are saved to the database and are not public until you click Save.
        </p>
        <Link href="/dashboard/editor" className="inline-block rounded px-4 py-2" style={{ backgroundColor: "#505542", color: "#fff" }}>
          Open Editor Mode
        </Link>
      </div>

      {/* Bottom Metrics */}
      <div>
        <h2 className="text-lg font-bold mb-4">Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Members</p>
            <p className="text-2xl font-bold">{membersCount}</p>
            <Link href="/dashboard/members" className="text-sm hover:underline" style={{ color: "#505542" }}>View</Link>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Subscriptions</p>
            <p className="text-2xl font-bold">{subscriptionsCount}</p>
            <Link href="/dashboard/subscriptions" className="text-sm hover:underline" style={{ color: "#505542" }}>View</Link>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Events</p>
            <p className="text-2xl font-bold">{eventsCount}</p>
            <Link href="/dashboard/events" className="text-sm hover:underline" style={{ color: "#505542" }}>View</Link>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-gray-600 text-sm">Coupons</p>
            <p className="text-2xl font-bold">{couponsCount}</p>
            <Link href="/dashboard/coupons" className="text-sm hover:underline" style={{ color: "#505542" }}>View</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
