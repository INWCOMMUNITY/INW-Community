import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BusinessHubFormModals } from "@/components/BusinessHubFormModals";
import { SellerHubBusinessHubMobileRedirect } from "@/components/SellerHubBusinessHubMobileRedirect";
import { getBusinessHubLiveCounts } from "@/lib/business-hub-live-counts";

export const dynamic = "force-dynamic";

export default async function SellerHubBusinessHubPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const [businesses, liveCounts] = await Promise.all([
    prisma.business.findMany({
      where: { memberId: session.user.id },
      select: { id: true, name: true, slug: true, logoUrl: true },
    }),
    getBusinessHubLiveCounts(session.user.id),
  ]);

  return (
    <>
      <SellerHubBusinessHubMobileRedirect />
      <div className="hidden lg:block">
        <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <div className="max-w-[var(--max-width)] mx-auto">
            <BusinessHubFormModals
              businesses={businesses}
              isSeller={true}
              hasSellerHubAccess={true}
              sellerHubReturnInForm={true}
              liveCounts={liveCounts}
            />
          </div>
        </section>
      </div>
    </>
  );
}
