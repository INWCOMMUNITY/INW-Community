import Link from "next/link";

export default function OtherActionsPage() {
  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Other Actions</h2>
      <p className="text-gray-600 mb-4">
        Access Sponsor Hub features: business directory, coupons, events, and rewards.
      </p>
      <div className="space-y-2">
        <Link href="/sponsor-hub/business" className="block text-primary-600 hover:underline">
          Manage business profile
        </Link>
        <Link href="/sponsor-hub/coupon" className="block text-primary-600 hover:underline">
          Offer a coupon
        </Link>
        <Link href="/sponsor-hub/event" className="block text-primary-600 hover:underline">
          Post an event
        </Link>
        <Link href="/sponsor-hub/reward" className="block text-primary-600 hover:underline">
          Offer a reward
        </Link>
      </div>
    </div>
  );
}
