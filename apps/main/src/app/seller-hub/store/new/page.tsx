import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { StoreItemForm } from "@/components/StoreItemForm";

export default async function NewStoreItemPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/store/new");
  }
  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(session.user.id),
  });
  if (!sub) {
    return (
      <section
        className="flex flex-col justify-end min-h-[calc(100dvh-5rem)] box-border w-full"
        style={{ padding: "var(--section-padding)", paddingTop: "1.5rem", paddingBottom: "3rem" }}
      >
        <div className="max-w-[var(--max-width)] mx-auto text-center w-full">
          <h1 className="text-2xl font-bold mb-4">List Items</h1>
          <p className="mb-6">
            List Items is available to members on the Seller plan. Subscribe to unlock this feature.
          </p>
          <Link href="/support-nwc" className="btn">View plans</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="py-8 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-5xl mx-auto">
        <Link href="/seller-hub/store/items" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
          ← Back to My Items
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold mb-6 text-gray-900">
          Sell Local: List an Item for sale on our storefront
        </h1>
        <StoreItemForm />
      </div>
    </section>
  );
}
