import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { BusinessForm } from "@/components/BusinessForm";
import { DeleteBusinessButton } from "@/components/DeleteBusinessButton";

export default async function SponsorHubBusinessEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/sponsor-hub/business");
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
  });
  if (!sub) redirect("/sponsor-hub");
  const { id } = await params;
  const business = await prisma.business.findFirst({
    where: { id, memberId: session.user.id },
  });
  if (!business) notFound();

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/sponsor-hub/business" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to businesses
        </Link>
        <h1 className="text-2xl font-bold mb-6">Edit Local Business Page</h1>
        <BusinessForm existing={business} />
        <div className="mt-8 pt-6 border-t border-gray-200">
          <DeleteBusinessButton businessId={business.id} businessName={business.name ?? "this business"} />
        </div>
      </div>
    </section>
  );
}
