import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { SellerSidebar } from "@/components/SellerSidebar";

export default async function SponsorHubBusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const isSeller =
    session?.user?.id &&
    (await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "seller", status: "active" },
    }));

  if (isSeller) {
    return (
      <div className="seller-hub-layout flex gap-0 md:gap-8 py-8" style={{ padding: "var(--section-padding)" }}>
        <aside className="hidden md:block shrink-0 no-print">
          <SellerSidebar />
        </aside>
        <main className="flex-1 min-w-0 w-full md:w-auto">{children}</main>
        <div className="md:hidden w-0 min-w-0 overflow-visible shrink-0">
          <SellerSidebar mobile />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
