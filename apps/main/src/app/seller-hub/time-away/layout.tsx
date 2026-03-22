import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

export default async function TimeAwayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/time-away");
  }
  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(session.user.id),
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
