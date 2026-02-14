import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { ResalePageContent } from "./ResalePageContent";

export const dynamic = "force-dynamic";

export default async function ResalePage() {
  const session = await getServerSession(authOptions);
  let sellerPlan = false;
  let subscribePlan = false;
  if (session?.user?.id) {
    const subs = await prisma.subscription.findMany({
      where: { memberId: session.user.id, status: "active" },
      select: { plan: true },
    });
    sellerPlan = subs.some((s) => s.plan === "seller");
    subscribePlan = subs.some((s) => s.plan === "subscribe");
  }

  return (
    <ResalePageContent
      canList={!!(session?.user && (sellerPlan || subscribePlan))}
      isSeller={!!sellerPlan}
    />
  );
}

