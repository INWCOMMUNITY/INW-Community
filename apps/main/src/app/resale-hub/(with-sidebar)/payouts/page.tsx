import Link from "next/link";

export default function ResaleHubPayoutsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Payouts</h1>
      <p className="text-gray-600 mb-6">
        When you sell items on Community Resale, earnings are added to your
        balance. Set up payouts to receive your funds.
      </p>
      <p className="text-sm text-gray-500 mb-6">
        Payout setup and balance will be available here once you have made a sale
        or connected your account.
      </p>
      <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline">
        Back to Resale Hub
      </Link>
    </div>
  );
}
