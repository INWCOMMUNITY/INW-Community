import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { ResaleHubTopNav } from "@/components/ResaleHubTopNav";

export const dynamic = "force-dynamic";

export default async function ResaleHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/resale-hub");
  }

  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const subscribeSub = await prisma.subscription.findFirst({
    where: {
      memberId: session.user.id,
      status: "active",
      plan: "subscribe",
    },
  });

  if (!subscribeSub && !isAdmin) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">NWC Resale Hub</h1>
          <p className="mb-6">
            The Resident Subscribe plan ($10/mo) includes Resale Hub, the coupon book, and 2× rewards points.
            To sell new items on the storefront, use the Seller plan and Seller Hub.
          </p>
          <a href="/support-nwc" className="btn">
            View plans
          </a>
        </div>
      </section>
    );
  }

  return (
    <>
      <ResaleHubTopNav />
      {children}
    </>
  );
}
