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
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
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
    <section className="py-12 px-4 flex flex-col items-center" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto w-full flex flex-col items-center">
        <Link href="/seller-hub/store/items" className="text-sm text-gray-600 hover:underline mb-4">
          ← Back to My Items
        </Link>
        <h1 className="text-3xl font-bold mb-6 text-center">
          Sell Local: List an item for sale on our storefront!
        </h1>
        <StoreItemForm />
      </div>
    </section>
  );
}
