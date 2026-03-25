import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereMemberSubscribeTierPerksAccess } from "@/lib/subscribe-plan-access";
import { ResaleHubTopNav } from "@/components/ResaleHubTopNav";
import { HubWebChrome } from "@/components/HubWebChrome";

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
    where: prismaWhereMemberSubscribeTierPerksAccess(session.user.id),
  });

  if (!subscribeSub && !isAdmin) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">NWC Resale Hub</h1>
          <p className="mb-6">
            Subscribe, Business, and Seller plans include Resale Hub, the coupon book, and 2× rewards points.
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
    <Suspense
      fallback={
        <>
          <ResaleHubTopNav />
          {children}
        </>
      }
    >
      <HubWebChrome variant="resale">{children}</HubWebChrome>
    </Suspense>
  );
}
