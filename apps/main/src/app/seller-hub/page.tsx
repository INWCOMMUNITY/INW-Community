import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { SellerHubMobileHome } from "@/components/SellerHubMobileHome";
import { SellerHubWorkQueue } from "@/components/SellerHubWorkQueue";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

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
        <div className="lg:hidden bg-white min-h-[calc(100dvh-5rem)]">
          <SellerHubMobileHome hasLocalDelivery={hasLocalDelivery} />
        </div>

        <section className="hidden lg:block py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
            <div className="text-center mb-10">
              <h1
                className="text-3xl md:text-4xl font-bold mb-2"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
              >
                Seller Hub
              </h1>
              <p className="text-gray-600">Manage your storefront, ship orders, get paid.</p>
            </div>
            <SellerHubWorkQueue hasLocalDelivery={hasLocalDelivery} variant="desktop" />
            <div className="mt-12 pt-8 border-t border-gray-200 text-center">
              <Link
                href="/business-hub?from=seller-hub"
                className="font-medium inline-block px-4 py-2 rounded transition hover:bg-[var(--color-section-alt)]"
                style={{ color: "var(--color-primary)" }}
              >
                Go to Business Hub
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
