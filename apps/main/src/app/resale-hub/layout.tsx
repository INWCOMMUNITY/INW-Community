import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereMemberSubscribePlanAccess } from "@/lib/subscribe-plan-access";
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
    where: prismaWhereMemberSubscribePlanAccess(session.user.id),
  });

  if (!subscribeSub && !isAdmin) {
    return (
      <section
        className="flex flex-col justify-end min-h-[calc(100dvh-5rem)] box-border w-full"
        style={{ padding: "var(--section-padding)", paddingTop: "1.5rem", paddingBottom: "3rem" }}
      >
        <div className="max-w-[var(--max-width)] mx-auto text-center w-full">
          <h1 className="text-2xl font-bold mb-4">NWC Resale Hub</h1>
          <p className="mb-6">
            NWC Resale Hub is included with the Resident Subscribe plan. Business and Seller plans include the coupon
            book and 2× rewards points, and use Business Hub / Seller Hub to sell; add Subscribe if you also want the
            member resale experience.
          </p>
          <a href="/support-nwc" className="btn">
            View plans
          </a>
        </div>
      </section>
    );
  }

  return <HubWebChrome variant="resale">{children}</HubWebChrome>;
}
