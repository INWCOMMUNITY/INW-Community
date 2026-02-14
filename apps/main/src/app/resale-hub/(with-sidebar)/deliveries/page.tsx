import Link from "next/link";

export default function ResaleHubDeliveriesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Deliveries</h1>
      <p className="text-gray-600 mb-6">
        Resale orders with local delivery will appear here. Mark them as
        delivered when you complete the drop-off.
      </p>
      <p className="text-sm text-gray-500">
        No delivery orders right now.
      </p>
      <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-4 inline-block">
        Back to Resale Hub
      </Link>
    </div>
  );
}
