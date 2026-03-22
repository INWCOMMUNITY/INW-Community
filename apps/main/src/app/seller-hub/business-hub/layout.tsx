import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

export default async function SellerHubBusinessHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/business-hub");
  }
  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(session.user.id),
  });
  if (!sub) {
    redirect("/seller-hub");
  }
  return <>{children}</>;
}
