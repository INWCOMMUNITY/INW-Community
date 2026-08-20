import { redirect } from "next/navigation";
import { prisma } from "database";
import { getServerSession } from "@/lib/auth";
import Link from "next/link";
import { BusinessHubFormModals } from "@/components/BusinessHubFormModals";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { prismaWhereMemberSponsorOrSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { getBusinessHubLiveCounts } from "@/lib/business-hub-live-counts";

export const dynamic = "force-dynamic";

function parseOpenModal(
  raw: string | string[] | undefined
): "coupon" | "event" | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "coupon" || v === "event") return v;
  return null;
}

export default async function BusinessHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const sp = await searchParams;
    const initialOpenModal = parseOpenModal(sp.open);
    const session = await getServerSession();
    if (!session?.user?.id) {
      redirect("/login?callbackUrl=/business-hub");
    }
    const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
    const [sub, hasAccess] = await Promise.all([
      prisma.subscription.findFirst({
        where: prismaWhereMemberSponsorOrSellerPlanAccess(session.user.id),
      }),
      hasBusinessHubAccess(session.user.id),
    ]);
    const isSeller = sub?.plan === "seller";
    if (!hasAccess && !isAdmin) {
      return (
        <section
          className="flex flex-col justify-end min-h-[calc(100dvh-5rem)] box-border w-full"
          style={{ padding: "var(--section-padding)", paddingTop: "1.5rem", paddingBottom: "3rem" }}
        >
          <div className="max-w-[var(--max-width)] mx-auto text-center w-full">
            <h1 className="text-[1.4rem] md:text-2xl font-bold mb-4">Business Hub</h1>
            <p className="mb-6">
              Business Hub is available to members with an active Business or Seller subscription. Choose a plan on Support NWC to unlock your business directory listing, coupons, and event posting.
            </p>
            <Link href="/support-nwc" className="btn">View plans</Link>
          </div>
        </section>
      );
    }

    const [businesses, liveCounts] = await Promise.all([
      prisma.business.findMany({
        where: { memberId: session.user.id },
        select: { id: true, name: true, slug: true, logoUrl: true },
      }),
      getBusinessHubLiveCounts(session.user.id),
    ]);

    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <BusinessHubFormModals
            businesses={businesses}
            isSeller={isSeller}
            hasSellerHubAccess={isSeller || isAdmin}
            initialOpenModal={initialOpenModal}
            liveCounts={liveCounts}
          />
        </div>
      </section>
    );
  } catch (e) {
    // Re-throw Next.js redirect so it works
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
