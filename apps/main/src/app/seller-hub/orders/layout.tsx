import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";

export default async function SellerOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/orders");
  }
  /** Seller list + labels; Business-plan members need order detail for reward fulfillments (same sellerId as business owner). */
  const sub = await prisma.subscription.findFirst({
    where: {
      memberId: session.user.id,
      plan: { in: ["seller", "sponsor", "subscribe"] },
      status: "active",
    },
  });
  if (!sub) {
    redirect("/seller-hub");
  }
  return (
    <div className="py-8" style={{ padding: "var(--section-padding)" }}>
      <main className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">{children}</main>
    </div>
  );
}
