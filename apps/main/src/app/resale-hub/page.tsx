import Link from "next/link";
import { ResaleHubShippingPolicy } from "@/components/ResaleHubShippingPolicy";

export default function ResaleHubPage() {
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-8">
          <Link
            href="/resale-hub/list"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">List an Item</h2>
            <p className="text-[0.735rem] text-gray-600">
              Add a resale listing with photos, price, and delivery options.
            </p>
          </Link>
          <Link
            href="/resale-hub/listings"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">My Listings</h2>
            <p className="text-[0.735rem] text-gray-600">
              Edit, delete, or mark your resale items as sold.
            </p>
          </Link>
          <Link
            href="/resale-hub/ship"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">Ship an Item</h2>
            <p className="text-[0.735rem] text-gray-600">
              Purchase shipping labels and mark orders as shipped.
            </p>
          </Link>
          <Link
            href="/resale-hub/deliveries"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">My Deliveries</h2>
            <p className="text-[0.735rem] text-gray-600">
              View and confirm local delivery orders. Mark as delivered when complete.
            </p>
          </Link>
          <Link
            href="/resale-hub/pickups"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">My Pickups</h2>
            <p className="text-[0.735rem] text-gray-600">
              View pickup orders. Mark as picked up when the buyer collects.
            </p>
          </Link>
          <Link
            href="/resale-hub/offers"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">New Offers</h2>
            <p className="text-[0.735rem] text-gray-600">
              Review and accept or decline offers from buyers.
            </p>
          </Link>
          <Link
            href="/resale-hub/messages"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">My Messages</h2>
            <p className="text-[0.735rem] text-gray-600">
              Chat with buyers about your listings.
            </p>
          </Link>
          <Link
            href="/resale-hub/payouts"
            className="w-full min-w-0 border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)]"
          >
            <h2 className="text-sm sm:text-xl font-bold mb-2">My Payouts</h2>
            <p className="text-[0.735rem] text-gray-600">
              View your balance and payout setup.
            </p>
          </Link>
        </div>
        <ResaleHubShippingPolicy />
        <div className="mt-12 pt-8 border-t border-gray-200">
          <Link
            href="/resale"
            className="text-primary-600 hover:underline font-medium inline-block px-4 py-2 rounded transition hover:bg-[var(--color-section-alt)]"
          >
            Browse Community Resale store
          </Link>
        </div>
      </div>
    </section>
  );
}
