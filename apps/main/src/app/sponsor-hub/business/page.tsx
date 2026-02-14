import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { DownloadFlyerButton } from "@/components/DownloadFlyerButton";

const MAX_BUSINESSES = 2;

export default async function SponsorHubBusinessListPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/sponsor-hub/business");
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
  });
  if (!sub) redirect("/sponsor-hub");
  const businesses = await prisma.business.findMany({
    where: { memberId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
  const canAdd = businesses.length < MAX_BUSINESSES;

  return (
    <section className="py-12 w-full">
      <div className="w-full max-w-[var(--max-width)] mx-auto px-3 sm:px-4 text-center flex flex-col items-center">
        <Link href="/sponsor-hub" className="text-sm text-gray-600 hover:underline mb-4 block w-full">
          ← Back to Sponsor Hub
        </Link>
        <h1 className="text-2xl font-bold mb-6 w-full">Set up / Edit Local Business Page</h1>
        <p className="text-gray-600 mb-6 max-w-xl w-full">
          You can have up to {MAX_BUSINESSES} businesses. Add or edit your business information for the Support Local directory.
        </p>
        <ul className="space-y-4 mb-8 w-full">
          {businesses.map((b) => (
            <li key={b.id} className="border rounded-lg p-4 flex flex-col items-center text-center w-full">
              <h2 className="text-xl md:text-2xl font-bold mb-3" style={{ color: "var(--color-heading)" }}>
                {b.name}
              </h2>
              <div className="flex justify-between items-center gap-4 w-full">
                <a
                  href={`/api/businesses/${b.id}/qr`}
                  download={`nwc-qr-${b.slug}.png`}
                  className="btn text-sm border border-gray-300 bg-white hover:bg-gray-50 shrink-0"
                >
                  QR
                </a>
                <DownloadFlyerButton
                  businessId={b.id}
                  slug={b.slug}
                  className="btn text-sm border border-gray-300 bg-white hover:bg-gray-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Flyer
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 inline-block" aria-hidden>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </span>
                </DownloadFlyerButton>
                <Link href={`/sponsor-hub/business/${b.id}`} className="btn text-sm shrink-0">
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
        {canAdd ? (
          <Link href="/sponsor-hub/business/new" className="btn">
            Add business
          </Link>
        ) : (
          <p className="text-gray-500 text-sm">Maximum {MAX_BUSINESSES} businesses. Edit an existing one above.</p>
        )}
      </div>
    </section>
  );
}
