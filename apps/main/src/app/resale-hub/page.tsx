import Link from "next/link";
import { prisma } from "database";
import { getServerSession } from "@/lib/auth";
import { IonIcon } from "@/components/IonIcon";
import { WIX_IMG } from "@/lib/wix-media";
import { HubExclamationBadge } from "@/components/HubExclamationBadge";

const RESALE_HUB_HEADER_IMAGE =
  "2bdd49_f582d22b864044b096a7f124f1b6efda~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203_edited.jpg";

export const dynamic = "force-dynamic";

export default async function ResaleHubPage() {
  const session = await getServerSession();
  const uid = session?.user?.id;
  let toShipResaleCount = 0;
  let pendingOffersResaleCount = 0;
  if (uid) {
    [toShipResaleCount, pendingOffersResaleCount] = await Promise.all([
      prisma.storeOrder.count({
        where: {
          sellerId: uid,
          status: "paid",
          shippedWithOrderId: null,
          shipment: { is: null },
          items: { some: { storeItem: { listingType: "resale" } } },
        },
      }),
      prisma.resaleOffer.count({
        where: {
          status: "pending",
          storeItem: { memberId: uid, listingType: "resale" },
        },
      }),
    ]);
  }

  const cards = [
    { href: "/resale-hub/list", label: "List Item", icon: "add-circle" as const, desc: "Add a resale listing with photos, price, and delivery options.", badge: false },
    { href: "/resale-hub/listings", label: "My Listings", icon: "list" as const, desc: "Edit, pause, or remove your resale listings.", badge: false },
    { href: "/resale-hub/orders", label: "Orders / To Ship", icon: "receipt-outline" as const, desc: "View orders and purchase shipping labels.", badge: toShipResaleCount > 0 },
    { href: "/resale-hub/deliveries", label: "Deliveries", icon: "car-outline" as const, desc: "View and confirm local delivery orders. Mark as delivered when complete.", badge: false },
    { href: "/resale-hub/pickups", label: "Pickups", icon: "hand-left-outline" as const, desc: "View pickup orders. Mark as picked up when the buyer collects.", badge: false },
    { href: "/resale-hub/offers", label: "Offers", icon: "pricetag-outline" as const, desc: "Review and accept or decline offers from buyers.", badge: pendingOffersResaleCount > 0 },
    { href: "/resale-hub/messages", label: "Messages", icon: "chatbubbles" as const, desc: "Chat with buyers about your listings.", badge: false },
    { href: "/resale-hub/cancellations", label: "Cancellations", icon: "close-circle" as const, desc: "Review canceled orders and next steps.", badge: false },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" as const, desc: "Let buyers know when you are not shipping or fulfilling orders.", badge: false },
    { href: "/resale-hub/payouts", label: "Payouts", icon: "wallet" as const, desc: "View your balance and payout setup.", badge: false },
    { href: "/resale-hub/before-you-start", label: "Before You Start", icon: "checkbox-outline" as const, desc: "Set up payments, shipping, and your policies.", badge: false },
  ];

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
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="relative hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
              >
                <HubExclamationBadge show={card.badge} />
                <IonIcon name={card.icon} size={28} className="text-[var(--color-primary)] mb-2" />
                <h2 className="text-xl font-bold mb-2">{card.label}</h2>
                <p className="text-sm text-gray-600">{card.desc}</p>
              </Link>
            ))}
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
