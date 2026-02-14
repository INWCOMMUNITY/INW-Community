import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { BusinessForm } from "@/components/BusinessForm";

export default async function SponsorHubBusinessNewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/sponsor-hub/business/new");
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
  });
  if (!sub) redirect("/sponsor-hub");
  const count = await prisma.business.count({ where: { memberId: session.user.id } });
  if (count >= 2) redirect("/sponsor-hub/business");

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/sponsor-hub/business" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to businesses
        </Link>
        <h1 className="text-2xl font-bold mb-6">Set up Local Business Page</h1>
        <BusinessForm />
      </div>
    </section>
  );
}
