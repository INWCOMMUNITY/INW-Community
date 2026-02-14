import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { SellerSidebar } from "@/components/SellerSidebar";

export default async function SellerHubOffersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/offers");
  }
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: "seller", status: "active" },
  });
  if (!sub) {
    redirect("/seller-hub");
  }
  return (
    <div className="seller-hub-layout flex gap-8 py-8" style={{ padding: "var(--section-padding)" }}>
      <aside className="hidden md:block shrink-0 no-print">
        <SellerSidebar />
      </aside>
      <main className="flex-1 min-w-0 w-full md:w-auto">{children}</main>
      <div className="md:hidden">
        <SellerSidebar mobile />
      </div>
    </div>
  );
}
