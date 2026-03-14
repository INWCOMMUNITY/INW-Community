import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

export default function ResaleStorefrontPage() {
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
        <h1 className="text-2xl font-bold mb-2">Resale Storefront</h1>
        <p className="text-gray-600 mb-8">
          Manage your resale listings, orders, and fulfillment in one place.
        </p>
        <div className="flex flex-wrap justify-center gap-8">
          <Link
            href="/resale-hub/listings"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="cube-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">My Listings</h2>
            <p className="text-sm text-gray-600">
              Edit, delete, or mark your resale items as sold.
            </p>
          </Link>
          <Link
            href="/resale-hub/orders"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="receipt-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Orders</h2>
            <p className="text-sm text-gray-600">
              View orders and purchase shipping labels.
            </p>
          </Link>
          <Link
            href="/resale-hub/pickups"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="hand-left-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Pickups</h2>
            <p className="text-sm text-gray-600">
              View in-store pickup orders. Mark as picked up when the buyer collects.
            </p>
          </Link>
          <Link
            href="/resale-hub/deliveries"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="car-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Deliveries</h2>
            <p className="text-sm text-gray-600">
              View and confirm local delivery orders. Mark as delivered when complete.
            </p>
          </Link>
          <Link
            href="/resale-hub/offers"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="pricetag-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Offers</h2>
            <p className="text-sm text-gray-600">
              Review and accept or decline offers from buyers.
            </p>
          </Link>
          <Link
            href="/resale-hub/cancellations"
            className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
          >
            <IonIcon name="close-circle-outline" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Cancellations</h2>
            <p className="text-sm text-gray-600">
              View and manage cancellation and refund requests.
            </p>
          </Link>
        </div>
        <div className="mt-12 pt-8 border-t border-gray-200">
          <Link href="/resale-hub" className="text-primary-600 hover:underline font-medium inline-block px-4 py-2 rounded transition hover:bg-[var(--color-section-alt)]">
            ← Back to Resale Hub
          </Link>
        </div>
      </div>
    </section>
  );
}
