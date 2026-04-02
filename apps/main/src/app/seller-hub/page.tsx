import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { WIX_IMG } from "@/lib/wix-media";
import { IonIcon } from "@/components/IonIcon";
import { HubExclamationBadge } from "@/components/HubExclamationBadge";
import { SellerHubMobileHome } from "@/components/SellerHubMobileHome";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

const SELLER_HUB_HEADER_IMAGE =
  "2bdd49_f582d22b864044b096a7f124f1b6efda~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203_edited.jpg";

export const dynamic = "force-dynamic";

export default async function SellerHubPage() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      redirect("/login?callbackUrl=/seller-hub");
    }
    const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
    const sub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(session.user.id),
    });
    const hasLocalDelivery = (sub || isAdmin)
      ? await prisma.storeItem
          .findFirst({
            where: { memberId: session.user.id, localDeliveryAvailable: true },
            select: { id: true },
          })
          .then((r) => !!r)
      : false;
    const [toShipNewCount, pendingOffersNewCount] = await Promise.all([
      prisma.storeOrder.count({
        where: {
          sellerId: session.user.id,
          status: "paid",
          shippedWithOrderId: null,
          shipment: { is: null },
          items: { some: { storeItem: { listingType: "new" } } },
        },
      }),
      prisma.resaleOffer.count({
        where: {
          status: "pending",
          storeItem: { memberId: session.user.id, listingType: "new" },
        },
      }),
    ]);
    if (!sub && !isAdmin) {
      return (
        <section
          className="flex flex-col justify-end min-h-[calc(100dvh-5rem)] box-border w-full"
          style={{ padding: "var(--section-padding)", paddingTop: "1.5rem", paddingBottom: "3rem" }}
        >
          <div className="max-w-[var(--max-width)] mx-auto text-center w-full">
            <h1 className="text-[1.4rem] md:text-2xl font-bold mb-4">Seller Hub</h1>
            <p className="mb-6">
              Seller Hub is available to members on the Seller plan. Subscribe to unlock storefront listing and order management.
            </p>
            <Link href="/support-nwc" className="btn">View plans</Link>
          </div>
        </section>
      );
    }

    return (
      <>
        <header
          className="hidden lg:flex relative w-full aspect-[3/1] min-h-[260px] max-h-[52vh] items-center justify-center overflow-hidden bg-gray-900"
          style={{
            backgroundImage: `url(${WIX_IMG(SELLER_HUB_HEADER_IMAGE)})`,
            backgroundSize: "cover",
            backgroundPosition: "50% 65%",
            backgroundRepeat: "no-repeat",
          }}
        >
          <div className="relative z-10 w-full max-w-2xl mx-auto px-3 max-md:px-2 py-4 max-md:py-3 md:px-6 md:py-10">
            <div className="bg-white/60 backdrop-blur-sm rounded-lg shadow-lg p-4 max-md:p-3 md:p-10 text-center max-md:max-h-[85%] max-md:overflow-auto max-md:max-w-[300px] max-md:mx-auto">
              <h1 className="text-[2.1rem] max-md:text-lg md:text-5xl font-bold mb-3 max-md:mb-2 text-black">
                Seller Hub
              </h1>
              <p className="text-black leading-relaxed max-md:text-xs max-md:leading-snug">
                Welcome to Northwest Communities Seller Hub. Manage your storefront, list items, and fulfill orders. You can also use Business Hub for your directory listing, coupons, events, and rewards. Thanks for being here!
              </p>
            </div>
          </div>
        </header>

        <div className="lg:hidden bg-white min-h-[calc(100dvh-5rem)]">
          <SellerHubMobileHome hasLocalDelivery={hasLocalDelivery} />
        </div>

      <section className="hidden lg:block py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
          <div className="flex flex-wrap justify-center gap-8">
            <Link
              href="/seller-hub/store"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="storefront" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Storefront Info</h2>
              <p className="text-sm text-gray-600">
                View and edit your store information, policies, and payment setup.
              </p>
            </Link>
            <Link
              href="/seller-hub/store/items"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="add-circle" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">List Items</h2>
              <p className="text-sm text-gray-600">
                Add products to the NWC Storefront. Set prices, photos, shipping, and receive payments directly.
              </p>
            </Link>
            <Link
              href="/seller-hub/store/manage"
              className="relative hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <HubExclamationBadge show={pendingOffersNewCount > 0} />
              <IonIcon name="list" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Manage Store</h2>
              <p className="text-sm text-gray-600">
                View your listings, sold items, offers, and refund requests.
              </p>
            </Link>
            <Link
              href="/seller-hub/orders"
              className="relative hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <HubExclamationBadge show={toShipNewCount > 0} />
              <IonIcon name="receipt" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Orders / Ship Items</h2>
              <p className="text-sm text-gray-600">
                View orders and purchase shipping labels.
              </p>
            </Link>
            {hasLocalDelivery && (
              <Link
                href="/seller-hub/deliveries"
                className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
              >
                <IonIcon name="bicycle" size={28} className="text-[var(--color-primary)] mb-2" />
                <h2 className="text-xl font-bold mb-2">My Deliveries</h2>
                <p className="text-sm text-gray-600">
                  View and confirm local delivery orders. Mark as delivered when complete.
                </p>
              </Link>
            )}
            <Link
              href="/seller-hub/pickups"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="hand-left-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">My Pickups</h2>
              <p className="text-sm text-gray-600">
                View in-store pickup orders. Mark as picked up when the buyer collects.
              </p>
            </Link>
            <Link
              href="/seller-hub/store/payouts"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="wallet" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Payouts</h2>
              <p className="text-sm text-gray-600">
                View your balance and send funds to your bank account.
              </p>
            </Link>
            <Link
              href="/seller-hub/policies"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="book-outline" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Policies</h2>
              <p className="text-sm text-gray-600">
                Set your shipping, delivery, pickup, and refund policies for your listings.
              </p>
            </Link>
            <Link
              href="/seller-hub/shipping-setup"
              className="hub-card w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
            >
              <IonIcon name="checkbox" size={28} className="text-[var(--color-primary)] mb-2" />
              <h2 className="text-xl font-bold mb-2">Before You Start</h2>
              <p className="text-sm text-gray-600">
                Connect payment and shipping so you can list items and get paid.
              </p>
            </Link>
          </div>
          <div className="mt-12 pt-8 border-t border-gray-200">
            <Link href="/seller-hub/sponsor-hub" className="text-primary-600 hover:underline font-medium inline-block px-4 py-2 rounded transition hover:bg-[var(--color-section-alt)]">
              ← Go to Business Hub (business directory, coupons, events, rewards)
            </Link>
          </div>
        </div>
      </section>
      </>
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).includes("NEXT_REDIRECT")) {
      throw e;
    }
    const isDb = /P1001|ECONNREFUSED|connect/i.test(String(e));
    throw new Error(
      isDb
        ? "Database connection failed. Make sure PostgreSQL is running (e.g. net start postgresql-x64-16)."
        : e instanceof Error ? e.message : "Something went wrong"
    );
  }
}
