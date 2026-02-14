import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { SponsorHubCardsWithModals } from "@/components/SponsorHubCardsWithModals";

export const dynamic = "force-dynamic";

export default async function SellerHubSponsorHubPage() {
  const session = await getServerSession(authOptions);
  const businesses = session?.user?.id
    ? await prisma.business.findMany({
        where: { memberId: session.user.id },
        select: { id: true, name: true },
      })
    : [];

  return (
    <section className="py-12 px-4 max-md:flex max-md:flex-col max-md:items-center" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto w-full max-md:px-4 max-md:flex max-md:flex-col max-md:items-center">
        <h1 className="text-2xl font-bold mb-6 max-md:text-center">Sponsor Hub</h1>
        <p className="text-gray-600 mb-8 max-md:text-center">
          Offer coupons, rewards, and post events to the community. Manage your business page from the menu.
        </p>
        <SponsorHubCardsWithModals businesses={businesses} />
      </div>
    </section>
  );
}
