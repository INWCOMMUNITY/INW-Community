import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

/**
 * Seller-plan members use Seller Hub as the single place for all orders and fulfillment.
 * Resale Hub duplicate routes redirect to the matching seller-hub path.
 */
export async function redirectSellerFromResaleHubTo(sellerHubPath: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return;
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(session.user.id),
  });
  if (sellerSub || isAdmin) {
    redirect(sellerHubPath);
  }
}
