import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { SellerSidebar } from "@/components/SellerSidebar";

export default async function ShippingSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/shipping-setup");
  }
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: "seller", status: "active" },
  });
  if (!sub) {
    redirect("/seller-hub");
  }
  return (
    <div className="seller-hub-layout flex gap-8 max-md:gap-0 py-8" style={{ padding: "var(--section-padding)" }}>
      <aside className="hidden md:block shrink-0 no-print">
        <SellerSidebar />
      </aside>
      <main className="flex-1 min-w-0 w-full md:w-auto">{children}</main>
      <div className="md:hidden shrink-0 w-0 overflow-visible">
        <SellerSidebar mobile />
      </div>
    </div>
  );
}
