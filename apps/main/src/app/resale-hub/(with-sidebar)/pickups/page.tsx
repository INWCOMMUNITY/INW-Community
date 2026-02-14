import Link from "next/link";

export default function ResaleHubPickupsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Pickups</h1>
      <p className="text-gray-600 mb-6">
        Resale orders with pickup will appear here. Mark them as picked
        up when the buyer collects the item.
      </p>
      <p className="text-sm text-gray-500">
        No pickup orders right now.
      </p>
      <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-4 inline-block">
        Back to Resale Hub
      </Link>
    </div>
  );
}
