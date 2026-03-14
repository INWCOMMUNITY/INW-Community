import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { WIX_IMG } from "@/lib/wix-media";

const RESALE_HUB_HEADER_IMAGE =
  "2bdd49_f582d22b864044b096a7f124f1b6efda~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203_edited.jpg";

export default function ResaleHubPage() {
  return (
    <>
      <header
        className="relative w-full aspect-[3/1] min-h-[260px] max-h-[52vh] flex items-center justify-center overflow-hidden bg-gray-900"
        style={{
          backgroundImage: `url(${WIX_IMG(RESALE_HUB_HEADER_IMAGE)})`,
          backgroundSize: "cover",
          backgroundPosition: "50% 65%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="relative z-10 w-full max-w-2xl mx-auto px-3 max-md:px-2 py-4 max-md:py-3 md:px-6 md:py-10">
          <div className="bg-white/60 backdrop-blur-sm rounded-lg shadow-lg p-4 max-md:p-3 md:p-10 text-center max-md:max-h-[85%] max-md:overflow-auto max-md:max-w-[300px] max-md:mx-auto">
            <h1 className="text-[2.1rem] max-md:text-lg md:text-5xl font-bold mb-3 max-md:mb-2 text-black">
              NWC Resale Hub
            </h1>
            <p className="text-black leading-relaxed max-md:text-xs max-md:leading-snug">
              List your pre-loved items, ship or deliver locally, respond to offers and messages, and manage your payouts—all in one place.
            </p>
          </div>
        </div>
      </header>
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
          <div className="flex flex-wrap justify-center gap-8">
            <Link
              href="/resale-hub/list"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="add-circle" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">List an Item</h2>
              <p className="text-sm text-gray-600">
                Add a resale listing with photos, price, and delivery options.
              </p>
            </Link>
            <Link
              href="/resale-hub/listings"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="list" size={28} className="text-[var(--color-primary)] mb-2" />
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
                View orders, purchase shipping labels, and mark as shipped.
              </p>
            </Link>
            <Link
              href="/resale-hub/ship"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="boat-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Ship an Item</h2>
              <p className="text-sm text-gray-600">
                Purchase shipping labels and mark orders as shipped.
              </p>
            </Link>
            <Link
              href="/resale-hub/deliveries"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="car-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Deliveries</h2>
              <p className="text-sm text-gray-600">
                View and confirm local delivery orders. Mark as delivered when complete.
              </p>
            </Link>
            <Link
              href="/resale-hub/pickups"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="hand-left-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Pickups</h2>
              <p className="text-sm text-gray-600">
                View pickup orders. Mark as picked up when the buyer collects.
              </p>
            </Link>
            <Link
              href="/resale-hub/offers"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="pricetag-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">New Offers</h2>
              <p className="text-sm text-gray-600">
                Review and accept or decline offers from buyers.
              </p>
            </Link>
            <Link
              href="/resale-hub/messages"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="chatbubbles" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Messages</h2>
              <p className="text-sm text-gray-600">
                Chat with buyers about your listings.
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
            <Link
              href="/resale-hub/payouts"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="wallet" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Payouts</h2>
              <p className="text-sm text-gray-600">
                View your balance and payout setup.
              </p>
            </Link>
            <Link
              href="/resale-hub/policies"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="book-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Policies</h2>
              <p className="text-sm text-gray-600">
                Set shipping, delivery, and pickup policies for your listings.
              </p>
            </Link>
          </div>
          <div className="mt-12 pt-8 border-t border-gray-200">
            <Link
              href="/resale"
              className="text-primary-600 hover:underline font-medium inline-block px-4 py-2 rounded transition hover:bg-[var(--color-section-alt)]"
            >
              Browse NWC Resale store
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
