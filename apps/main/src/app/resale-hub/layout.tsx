import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { ResaleHubHeader } from "@/components/ResaleHubHeader";

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
    where: { memberId: session.user.id, plan: "subscribe", status: "active" },
  });
  const sellerSub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: "seller", status: "active" },
  });

  if (sellerSub && !isAdmin) {
    redirect("/seller-hub?resale=1");
  }
  if (!subscribeSub && !isAdmin) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Community Resale Hub</h1>
          <p className="mb-6">
            Subscribe to list items on Community Resale. You can sell pre-loved
            items and ship or offer local delivery.
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
      <ResaleHubHeader />
      {children}
    </>
  );
}
