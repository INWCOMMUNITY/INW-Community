import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { StoreItemForm } from "@/components/StoreItemForm";

export default async function EditStoreItemPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/store");
  }
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: "seller", status: "active" },
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

  const item = await prisma.storeItem.findFirst({
    where: { id: params.id, memberId: session.user.id },
  });
  if (!item) {
    notFound();
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/seller-hub/store/items" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to List Items
        </Link>
        <h1 className="text-3xl font-bold mb-6">Edit item</h1>
        <StoreItemForm
          existing={{
            id: item.id,
            businessId: item.businessId,
            title: item.title,
            description: item.description,
            photos: item.photos,
            category: item.category,
            priceCents: item.priceCents,
            variants: item.variants,
            quantity: item.quantity,
            status: item.status,
            shippingCostCents: item.shippingCostCents,
            shippingPolicy: item.shippingPolicy,
            localDeliveryAvailable: item.localDeliveryAvailable,
            localDeliveryTerms: (item as { localDeliveryTerms?: string | null }).localDeliveryTerms ?? null,
          }}
        />
      </div>
    </section>
  );
}
