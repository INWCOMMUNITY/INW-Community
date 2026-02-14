import Link from "next/link";

export default function MySubscriptionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Subscriptions</h1>
      <p className="text-gray-600 mb-4">View and manage your subscription plans.</p>
      <Link href="/support-nwc" className="btn">
        View plans
      </Link>
    </div>
  );
}
