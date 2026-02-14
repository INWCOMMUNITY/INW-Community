import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { WIX_IMG } from "@/lib/wix-media";
import { SponsorHubFormModals } from "@/components/SponsorHubFormModals";

/** Sponsor Hub header – panorama (lake, dock, trees, sky) from gallery; wide crop so full scene shows; position shaves 12% off top */
const SPONSOR_HUB_HEADER_IMAGE =
  "2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg";

export const dynamic = "force-dynamic";

export default async function SponsorHubPage() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      redirect("/login?callbackUrl=/sponsor-hub");
    }
    const sub = await prisma.subscription.findFirst({
      where: {
        memberId: session.user.id,
        plan: { in: ["sponsor", "seller"] },
        status: "active",
      },
    });
    const isSeller = sub?.plan === "seller";
    const businesses = await prisma.business.findMany({
      where: { memberId: session.user.id },
      select: { id: true, name: true },
    });
    if (!sub) {
      return (
        <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <div className="max-w-[var(--max-width)] mx-auto text-center">
            <h1 className="text-[1.4rem] md:text-2xl font-bold mb-4">Sponsor Hub</h1>
            <p className="mb-6">
              Sponsor Hub is available to members on the Sponsor or Seller plan. Subscribe to unlock business directory listing, coupons, and event posting.
            </p>
            <Link href="/support-nwc" className="btn">View plans</Link>
          </div>
        </section>
      );
    }

    return (
      <>
        <header
          className="relative w-full aspect-[3/1] min-h-[260px] max-h-[52vh] flex items-center justify-center overflow-hidden bg-gray-900"
          style={{
            backgroundImage: `url(${WIX_IMG(SPONSOR_HUB_HEADER_IMAGE)})`,
            backgroundSize: "cover",
            backgroundPosition: "50% 65%",
            backgroundRepeat: "no-repeat",
          }}
        >
          <div className="relative z-10 w-full max-w-2xl mx-auto px-3 max-md:px-2 py-4 max-md:py-3 md:px-6 md:py-10">
            <div className="bg-white/60 backdrop-blur-sm rounded-lg shadow-lg p-4 max-md:p-3 md:p-10 text-center max-md:max-h-[85%] max-md:overflow-auto max-md:max-w-[300px] max-md:mx-auto">
              <h1 className="text-[2.1rem] max-md:text-lg md:text-5xl font-bold mb-3 max-md:mb-2 text-black">
                Sponsor Hub
              </h1>
              <p className="text-black leading-relaxed max-md:text-xs max-md:leading-snug">
                Welcome Local Business Owner to Northwest Communities Sponsor Hub. Here you can set up your business page, offer coupons to the community, post events on our event calendars, and market your business by offering rewards to community members who most actively support local businesses! Thanks for being here!
              </p>
            </div>
          </div>
        </header>
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <SponsorHubFormModals businesses={businesses} isSeller={isSeller} />
        </div>
      </section>
      </>
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
